/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IUpdateService, State, StateType } from '../../../../platform/update/common/update.js';
import { ILoopholeUpdateService } from '../common/voidUpdateService.js';
import { LoopholeCheckUpdateRespose } from '../common/voidUpdateServiceTypes.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILifecycleMainService } from '../../../../platform/lifecycle/electron-main/lifecycleMainService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { tmpdir, platform, arch } from 'os';
import { join } from 'path';
import * as fs from 'fs';
import * as pfs from '../../../../base/node/pfs.js';
import { spawn } from 'child_process';
import { asJson } from '../../../../platform/request/common/request.js';
import { timeout } from '../../../../base/common/async.js';

// GitHub Release Asset interface
interface IGitHubAsset {
	name: string;
	browser_download_url: string;
	size: number;
}

interface IGitHubRelease {
	tag_name: string;
	name: string;
	published_at: string;
	assets: IGitHubAsset[];
}

// Update states for GitHub-based updates
enum GitHubUpdateState {
	Idle = 'idle',
	Checking = 'checking',
	Available = 'available',
	Downloading = 'downloading',
	Downloaded = 'downloaded',
	Ready = 'ready',
	Error = 'error'
}

interface IGitHubUpdateInfo {
	version: string;
	assetUrl: string;
	assetName: string;
	downloadPath?: string;
}



interface IVersionsRepoRelease {
	version?: string;
	productVersion?: string;
	url: string;
	sha256hash?: string;
	timestamp?: number;
}

export class LoopholeMainUpdateService extends Disposable implements ILoopholeUpdateService {
	_serviceBrand: undefined;

	private _githubState: GitHubUpdateState = GitHubUpdateState.Idle;
	private _currentUpdate: IGitHubUpdateInfo | null = null;
	private readonly _cachePath: string;
	private _useGitHubUpdates: boolean = false;

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IUpdateService private readonly _updateService: IUpdateService,
		@IRequestService private readonly _requestService: IRequestService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@ILifecycleMainService private readonly _lifecycleMainService: ILifecycleMainService,
	) {
		super();
		this._cachePath = join(tmpdir(), `loophole-updates`);

		// Listen to VS Code update service state changes
		this._register(this._updateService.onStateChange(state => {
			this._onVSCodeUpdateStateChange(state);
		}));
	}


	private _onVSCodeUpdateStateChange(state: State): void {
		this._logService.info('[LoopholeUpdate] VS Code update state changed:', state.type);

		// If VS Code update service found an update, we don't need to use direct GitHub/versions updates
		if (state.type === StateType.Ready || state.type === StateType.Downloaded) {
			this._useGitHubUpdates = false;
		}
	}

	private _isNewerVersion(latestVersion: string, currentVersion: string): boolean {
		const parse = (v: string) => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map(n => parseInt(n, 10) || 0);
		const [la = 0, lb = 0, lc = 0] = parse(latestVersion);
		const [ca = 0, cb = 0, cc = 0] = parse(currentVersion);
		if (la !== ca) { return la > ca; }
		if (lb !== cb) { return lb > cb; }
		return lc > cc;
	}

	private _getVersionsRepoCandidateUrls(): string[] {
		const baseUrl = (this._productService.updateUrl || 'https://raw.githubusercontent.com/loophole-ai/versions/refs/heads/main').replace(/\/+$/, '');
		const quality = this._productService.quality || 'stable';
		const platformName = platform();
		const archName = arch() === 'arm64' ? 'arm64' : 'x64';

		if (platformName === 'win32') {
			// Windows user setup: stable/win32/<arch>/user/latest.json
			return [
				`${baseUrl}/${quality}/win32/${archName}/user/latest.json`,
			];
		} else if (platformName === 'darwin') {
			// macOS: stable/darwin/<arch>/latest.json with universal fallback for arm64
			const urls = [`${baseUrl}/${quality}/darwin/${archName}/latest.json`];
			if (archName === 'arm64') {
				urls.push(`${baseUrl}/${quality}/darwin/universal/latest.json`);
			}
			return urls;
		} else if (platformName === 'linux') {
			// Linux: stable/linux/<arch>/latest.json
			return [
				`${baseUrl}/${quality}/linux/${archName}/latest.json`,
			];
		}

		return [];
	}

	private async _checkVersionsRepo(explicit: boolean): Promise<LoopholeCheckUpdateRespose | null> {
		const candidateUrls = this._getVersionsRepoCandidateUrls();
		if (candidateUrls.length === 0) {
			return null;
		}

		this._logService.info('[LoopholeUpdate] Checking versions repository...');

		let release: IVersionsRepoRelease | null = null;
		let successfulUrl: string | null = null;

		for (const url of candidateUrls) {
			try {
				this._logService.info(`[LoopholeUpdate] Fetching version metadata from: ${url}`);
				const response = await this._requestService.request({
					url,
					headers: {
						'Cache-Control': 'no-cache',
						'User-Agent': `Loophole/${(this._productService as any).loopholeVersion ?? this._productService.version}`
					},
					callSite: 'LoopholeMainUpdateService._checkVersionsRepo'
				}, CancellationToken.None);

				release = await asJson<IVersionsRepoRelease>(response);
				if (release && release.url) {
					successfulUrl = url;
					break;
				}
			} catch (e) {
				this._logService.warn(`[LoopholeUpdate] Failed to fetch from ${url}:`, e instanceof Error ? e.message : String(e));
			}
		}

		if (!release || !release.url) {
			this._logService.warn('[LoopholeUpdate] No valid release found in versions repository');
			return null;
		}

		const latestVersion = (release.productVersion || release.version || '').replace(/^v/, '');
		const myVersion = String((this._productService as any).loopholeVersion ?? this._productService.version).replace(/^v/, '');

		this._logService.info(`[LoopholeUpdate] Versions repo check: current=${myVersion}, latest=${latestVersion}, source=${successfulUrl}`);

		if (!latestVersion) {
			this._logService.warn('[LoopholeUpdate] Release found in versions repo but has no version string');
			return null;
		}

		const isNewer = this._isNewerVersion(latestVersion, myVersion);

		if (!isNewer) {
			this._githubState = GitHubUpdateState.Idle;
			if (explicit) {
				return { message: 'Loophole is up-to-date!' } as const;
			}
			return { message: null } as const;
		}

		const assetName = release.url.substring(release.url.lastIndexOf('/') + 1) || `Loophole-update-${latestVersion}`;
		this._currentUpdate = {
			version: latestVersion,
			assetUrl: release.url,
			assetName
		};

		this._githubState = GitHubUpdateState.Available;
		this._useGitHubUpdates = true;

		// Check if we already have this update downloaded
		const downloadPath = join(this._cachePath, assetName);
		if (fs.existsSync(downloadPath)) {
			this._currentUpdate.downloadPath = downloadPath;
			this._githubState = GitHubUpdateState.Downloaded;

			if (platform() === 'win32') {
				this._githubState = GitHubUpdateState.Ready;
				return { message: 'Restart Loophole to update!', action: 'restart' } as const;
			}
		}

		// Return appropriate message based on platform
		if (platform() === 'win32') {
			return { message: 'A new version is available!', action: 'download' } as const;
		} else if (platform() === 'darwin') {
			return { message: `Update ${latestVersion} available! Download and replace your Loophole.app.`, action: 'download' } as const;
		} else {
			return { message: `Update ${latestVersion} available! Download and reinstall.`, action: 'download' } as const;
		}
	}

	async check(explicit: boolean): Promise<LoopholeCheckUpdateRespose> {
		const isDevMode = !this._envMainService.isBuilt;

		if (isDevMode) {
			return { message: null } as const;
		}

		// 1. Primary: check versions repository directly
		try {
			const versionsRes = await this._checkVersionsRepo(explicit);
			if (versionsRes !== null) {
				return versionsRes;
			}
		} catch (e) {
			this._logService.warn('[LoopholeUpdate] Error checking versions repository, falling back to GitHub releases:', e);
		}

		// 2. Fallback: check GitHub releases
		return await this._checkGitHubReleases(explicit);
	}

	private _getResponseFromVSCodeState(explicit: boolean): LoopholeCheckUpdateRespose {
		const state = this._updateService.state;

		switch (state.type) {
			case StateType.Uninitialized:
				return { message: explicit ? 'Checking for updates soon...' : null, action: explicit ? 'reinstall' : undefined } as const;

			case StateType.Idle:
				return { message: explicit ? 'No updates found!' : null, action: explicit ? 'reinstall' : undefined } as const;

			case StateType.CheckingForUpdates:
				return { message: explicit ? 'Checking for updates...' : null } as const;

			case StateType.AvailableForDownload:
				return { message: 'A new update is available!', action: 'download' } as const;

			case StateType.Downloading:
				return { message: explicit ? 'Currently downloading update...' : null } as const;

			case StateType.Downloaded:
				return { message: explicit ? 'An update is ready to be applied!' : null, action: 'apply' } as const;

			case StateType.Updating:
				return { message: explicit ? 'Applying update...' : null } as const;

			case StateType.Ready:
				return { message: 'Restart Loophole to update!', action: 'restart' } as const;

			case StateType.Disabled:
				// Will be handled by GitHub check
				return null;

			default:
				return null;
		}
	}

	private async _checkGitHubReleases(explicit: boolean): Promise<LoopholeCheckUpdateRespose> {
		this._logService.info('[LoopholeUpdate] Checking GitHub releases...');

		try {
			this._githubState = GitHubUpdateState.Checking;

			const response = await this._requestService.request({
				url: 'https://api.github.com/repos/loophole-ai/loophole-ide/releases/latest',
				headers: {
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': `Loophole/${(this._productService as any).loopholeVersion ?? this._productService.version}`
				},
				callSite: 'LoopholeMainUpdateService._checkGitHubReleases'
			}, CancellationToken.None);

			const release = await asJson<IGitHubRelease>(response);

			if (!release || !release.tag_name) {
				this._githubState = GitHubUpdateState.Idle;
				return { message: explicit ? 'No updates found!' : null } as const;
			}

			const latestVersion = release.tag_name.replace(/^v/, '');
			const myVersion = String((this._productService as any).loopholeVersion ?? this._productService.version).replace(/^v/, '');

			this._logService.info(`[LoopholeUpdate] Current: ${myVersion}, Latest: ${latestVersion}`);

			const isUpToDate = !this._isNewerVersion(latestVersion, myVersion);

			if (isUpToDate) {
				this._githubState = GitHubUpdateState.Idle;
				if (explicit) {
					return { message: 'Loophole is up-to-date!' } as const;
				}
				return { message: null } as const;
			}

			// Find appropriate asset for current platform
			const asset = this._findAssetForPlatform(release.assets, latestVersion);

			if (!asset) {
				this._githubState = GitHubUpdateState.Error;
				this._logService.warn('[LoopholeUpdate] No suitable asset found for platform:', platform(), arch());
				if (explicit) {
					return {
						message: `Update available (${latestVersion}), but no installer found for your platform. Please download manually.`,
						action: 'reinstall'
					} as const;
				}
				return { message: null } as const;
			}

			// Store update info
			this._currentUpdate = {
				version: latestVersion,
				assetUrl: asset.browser_download_url,
				assetName: asset.name
			};

			this._githubState = GitHubUpdateState.Available;
			this._useGitHubUpdates = true;

			// Check if we already have this update downloaded
			const downloadPath = join(this._cachePath, asset.name);
			if (fs.existsSync(downloadPath)) {
				this._currentUpdate.downloadPath = downloadPath;
				this._githubState = GitHubUpdateState.Downloaded;

				if (platform() === 'win32') {
					this._githubState = GitHubUpdateState.Ready;
					return { message: 'Restart Loophole to update!', action: 'restart' } as const;
				}
			}

			// Return appropriate message based on platform
			if (platform() === 'win32') {
				return { message: 'A new version is available!', action: 'download' } as const;
			} else if (platform() === 'darwin') {
				return { message: `Update ${latestVersion} available! Download and replace your Loophole.app.`, action: 'download' } as const;
			} else {
				return { message: `Update ${latestVersion} available! Download and reinstall.`, action: 'download' } as const;
			}

		} catch (e) {
			this._githubState = GitHubUpdateState.Error;
			this._logService.error('[LoopholeUpdate] Error checking GitHub:', e);

			if (explicit) {
				return {
					message: `Error checking for updates: ${e instanceof Error ? e.message : String(e)}. Please try again later.`,
					action: 'reinstall'
				} as const;
			}
			return { message: null } as const;
		}
	}

	private _findAssetForPlatform(assets: IGitHubAsset[], version: string): IGitHubAsset | undefined {
		const platformName = platform();
		const archName = arch();

		this._logService.info(`[LoopholeUpdate] Looking for asset: platform=${platformName}, arch=${archName}`);

		// Define patterns for different platforms
		let patterns: string[] = [];

		if (platformName === 'win32') {
			// Windows: LoopholeUserSetup-x64-2.x.x.exe / LoopholeSetup-arm64-2.x.x.exe
			if (archName === 'x64') {
				patterns = ['LoopholeUserSetup-x64', 'LoopholeSetup-x64', 'UserSetup-x64'];
			} else if (archName === 'arm64') {
				patterns = ['LoopholeUserSetup-arm64', 'LoopholeSetup-arm64', 'UserSetup-arm64'];
			} else {
				patterns = ['LoopholeUserSetup', 'LoopholeSetup', '.exe'];
			}
		} else if (platformName === 'darwin') {
			// macOS: Loophole-darwin-arm64-2.x.x.dmg / Loophole-darwin-x64-2.x.x.dmg / Loophole-darwin-universal-2.x.x.dmg
			if (archName === 'arm64') {
				// Prefer universal binary for Apple Silicon, fallback to arm64-specific
				patterns = ['Loophole-darwin-universal', 'Loophole-darwin-arm64', 'darwin-arm64', 'arm64.dmg'];
			} else {
				patterns = ['Loophole-darwin-x64', 'darwin-x64', 'x64.dmg'];
			}
		} else if (platformName === 'linux') {
			// Linux: Loophole-linux-x64-2.x.x.tar.gz / Loophole-linux-arm64-2.x.x.tar.gz
			if (archName === 'arm64') {
				patterns = ['Loophole-linux-arm64', 'linux-arm64', 'arm64.tar.gz'];
			} else {
				patterns = ['Loophole-linux-x64', 'linux-x64', 'x64.tar.gz'];
			}
		}

		// Try to find matching asset
		for (const pattern of patterns) {
			const asset = assets.find(a => a.name.toLowerCase().includes(pattern.toLowerCase()));
			if (asset) {
				this._logService.info(`[LoopholeUpdate] Found matching asset: ${asset.name}`);
				return asset;
			}
		}

		// Fallback: return first asset that looks like an installer
		const fallback = assets.find(a => {
			const name = a.name.toLowerCase();
			return name.endsWith('.exe') || name.endsWith('.dmg') || name.endsWith('.tar.gz') || name.endsWith('.appimage') || name.endsWith('.deb');
		});

		if (fallback) {
			this._logService.info(`[LoopholeUpdate] Using fallback asset: ${fallback.name}`);
		}

		return fallback;
	}

	async downloadUpdate(): Promise<boolean> {
		if (!this._currentUpdate || !this._useGitHubUpdates) {
			return false;
		}

		try {
			this._githubState = GitHubUpdateState.Downloading;
			this._logService.info(`[LoopholeUpdate] Downloading update: ${this._currentUpdate.assetName}`);

			// Ensure cache directory exists
			if (!fs.existsSync(this._cachePath)) {
				fs.mkdirSync(this._cachePath, { recursive: true });
			}

			const downloadPath = join(this._cachePath, this._currentUpdate.assetName);
			const tempPath = `${downloadPath}.tmp`;

			// Download the file
			const context = await this._requestService.request({
				url: this._currentUpdate.assetUrl,
				callSite: 'LoopholeMainUpdateService.downloadUpdate'
			}, CancellationToken.None);

			await this._fileService.writeFile(URI.file(tempPath), context.stream);

			// Rename temp to final
			fs.renameSync(tempPath, downloadPath);

			this._currentUpdate.downloadPath = downloadPath;
			this._githubState = GitHubUpdateState.Downloaded;

			this._logService.info(`[LoopholeUpdate] Download complete: ${downloadPath}`);

			// On Windows, we can auto-apply the update
			if (platform() === 'win32' && downloadPath.endsWith('.exe')) {
				this._githubState = GitHubUpdateState.Ready;
				return true;
			}

			return true;
		} catch (e) {
			this._githubState = GitHubUpdateState.Error;
			this._logService.error('[LoopholeUpdate] Download failed:', e instanceof Error ? e.message : String(e));
			return false;
		}
	}

	async applyUpdate(): Promise<boolean> {
		if (!this._currentUpdate?.downloadPath || !this._useGitHubUpdates) {
			return false;
		}

		const platformName = platform();
		const downloadPath = this._currentUpdate.downloadPath;

		try {
			if (platformName === 'win32' && downloadPath.endsWith('.exe')) {
				// Windows: Run the installer silently
				this._logService.info('[LoopholeUpdate] Applying Windows update...');

				spawn(downloadPath, ['/verysilent', '/mergetasks=!runcode,!desktopicon,!quicklaunchicon', '/nocancel', '/nocloseapplications'], {
					detached: true,
					stdio: ['ignore', 'ignore', 'ignore'],
					windowsVerbatimArguments: true
				});

				this._githubState = GitHubUpdateState.Ready;
				return true;
			} else if (platformName === 'darwin') {
				// macOS: Open the .dmg for the user to manually install
				this._logService.info('[LoopholeUpdate] Opening macOS installer...');
				spawn('open', [downloadPath], { detached: true });
				return true;
			} else {
				// Linux: Open the file location for manual install
				this._logService.info('[LoopholeUpdate] Opening file manager...');
				spawn('xdg-open', [this._cachePath], { detached: true });
				return true;
			}
		} catch (e) {
			this._logService.error('[LoopholeUpdate] Apply failed:', e);
			return false;
		}
	}

	async quitAndInstall(): Promise<void> {
		if (this._useGitHubUpdates && this._currentUpdate?.downloadPath) {
			const platformName = platform();
			const downloadPath = this._currentUpdate.downloadPath;

			if (platformName === 'win32' && downloadPath.endsWith('.exe')) {
				// Windows: Spawn a detached watcher that runs installer after app closes
				this._logService.info('[LoopholeUpdate] Preparing Windows update with watcher...');

				const installerPath = downloadPath;
				const updateScriptPath = join(this._cachePath, 'update-watcher.bat');

				// Create a batch script that waits for the app to close, then runs installer
				const batchScriptLines = [
					'@echo off',
					':: Wait for Loophole to close',
					'set /a attempts=0',
					':waitloop',
					'set /a attempts+=1',
					'if %attempts% gtr 40 goto runinstaller',
					'ping -n 2 127.0.0.1 >nul 2>&1',
					'tasklist /FI "IMAGENAME eq loophole.exe" 2>nul | find /I "loophole.exe" >nul',
					'if %errorlevel% equ 0 goto waitloop',
					'',
					':runinstaller',
					':: Run installer and wait for it to finish before cleaning up',
					`start /wait "" "${installerPath}" /verysilent /mergetasks=!runcode,!desktopicon,!quicklaunchicon /nocancel`,
					':: Clean up only after installer exits',
					`rmdir /s /q "${this._cachePath}"`,
					'del "%~f0"'
				];

				await pfs.Promises.writeFile(updateScriptPath, batchScriptLines.join('\r\n'));

				// Spawn the watcher script (detached, hidden)
				spawn('cmd.exe', ['/c', 'start', '/min', updateScriptPath], {
					detached: true,
					stdio: ['ignore', 'ignore', 'ignore'],
					windowsVerbatimArguments: true
				});

				// Small delay to ensure watcher has started
				await timeout(500);

				// Now quit the app - watcher will run installer after we close
				this._logService.info('[LoopholeUpdate] Quitting app for update...');
				await this._lifecycleMainService.quit(true);
			} else {
				// For other platforms, just apply (user needs to manually restart)
				await this.applyUpdate();
			}
		} else {
			await this._updateService.quitAndInstall();
		}
	}

	getGitHubUpdateState(): GitHubUpdateState {
		return this._githubState;
	}

	async getUpdateInfo(): Promise<{ version?: string; assetName?: string; isDownloaded?: boolean; isReady?: boolean }> {
		return {
			version: this._currentUpdate?.version,
			assetName: this._currentUpdate?.assetName,
			isDownloaded: !!this._currentUpdate?.downloadPath,
			isReady: this._githubState === GitHubUpdateState.Ready
		};
	}
}
