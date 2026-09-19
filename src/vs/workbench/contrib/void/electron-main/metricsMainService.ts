/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { StorageTarget, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';

import { IMetricsService } from '../common/metricsService.js';
import { PostHog } from 'posthog-node'
import { OPT_OUT_KEY } from '../common/storageKeys.js';

const FLUSH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes


const os = isWindows ? 'windows' : isMacintosh ? 'mac' : isLinux ? 'linux' : null
const _getOSInfo = () => {
	try {
		const { platform, arch } = process // see platform.ts
		return { platform, arch }
	}
	catch (e) {
		return { osInfo: { platform: '??', arch: '??' } }
	}
}
const osInfo = _getOSInfo()

// we'd like to use devDeviceId on telemetryService, but that gets sanitized by the time it gets here as 'someValue.devDeviceId'



export class MetricsMainService extends Disposable implements IMetricsService {
	_serviceBrand: undefined;

	private readonly client!: PostHog

	private _initProperties: object = {}
	private _flushInterval?: any
	private _distinctId?: string
	private _userId?: string
	private _oldId?: string
	private _isDevMode: boolean = false


	// helper - looks like this is stored in a .vscdb file in ~/Library/Application Support/Loophole
	private _memoStorage(key: string, target: StorageTarget, setValIfNotExist?: string) {
		try {
			const currVal = this._appStorage.get(key, StorageScope.APPLICATION)
			if (currVal !== undefined) return currVal
			const newVal = setValIfNotExist ?? generateUuid()
			this._appStorage.store(key, newVal, StorageScope.APPLICATION, target)
			return newVal
		} catch (error) {
			console.error('Failed to access storage for key:', key, error)
			return setValIfNotExist ?? generateUuid()
		}
	}


	// this is old, eventually we can just delete this since all the keys will have been transferred over
	// returns 'NULL' or the old key
	private get oldId() {
		if (this._oldId) return this._oldId
		// check new storage key first
		const newKey = 'loophole.app.oldMachineId'
		const newOldId = this._appStorage.get(newKey, StorageScope.APPLICATION)
		if (newOldId) {
			this._oldId = newOldId
			return newOldId
		}

		// put old key into new key if didn't already
		const oldValue = this._appStorage.get('void.machineId', StorageScope.APPLICATION) ?? 'NULL' // the old way of getting the key
		this._appStorage.store(newKey, oldValue, StorageScope.APPLICATION, StorageTarget.MACHINE)
		this._oldId = oldValue
		return oldValue

		// in a few weeks we can replace above with this
		// private get oldId() {
		// 	return this._memoStorage('loophole.app.oldMachineId', StorageTarget.MACHINE, 'NULL')
		// }
	}


	// the main id
	private get distinctId() {
		if (this._distinctId) return this._distinctId
		const oldId = this.oldId
		const setValIfNotExist = oldId === 'NULL' ? undefined : oldId
		this._distinctId = this._memoStorage('loophole.app.machineId', StorageTarget.MACHINE, setValIfNotExist)
		return this._distinctId
	}

	// just to see if there are ever multiple machineIDs per userID (instead of this, we should just track by the user's email)
	private get userId() {
		if (this._userId) return this._userId
		this._userId = this._memoStorage('loophole.app.userMachineId', StorageTarget.USER)
		return this._userId
	}

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IApplicationStorageMainService private readonly _appStorage: IApplicationStorageMainService,
	) {
		super()
		try {
			this.client = new PostHog('phc_oTDpdDZgxMUvGmfGoJMEKhazigTNMFeqSFb8zmH698wy', {
				host: 'https://us.i.posthog.com',
			})
		} catch (error) {
			console.error('Failed to initialize PostHog client:', error)
		}

		this.initialize() // async
	}

	async initialize() {
		try {
			// very important to await whenReady!
			await this._appStorage.whenReady

			const { commit, version, loopholeVersion, loopholeRelease, quality } = this._productService

			const isDevMode = !this._envMainService.isBuilt // found in abstractUpdateService.ts
			this._isDevMode = isDevMode

			// In development mode, log but don't send actual metrics
			if (isDevMode) {
				console.log('PostHog metrics running in development mode - events will be logged but not sent')
			}

			// custom properties we identify
			this._initProperties = {
				commit,
				vscodeVersion: version,
				loopholeVersion: loopholeVersion,
				release: loopholeRelease,
				os,
				quality,
				distinctId: this.distinctId,
				distinctIdUser: this.userId,
				oldId: this.oldId,
				isDevMode,
				...osInfo,
			}

			const identifyMessage = {
				distinctId: this.distinctId,
				properties: this._initProperties,
			}

			const didOptOut = this._appStorage.getBoolean(OPT_OUT_KEY, StorageScope.APPLICATION, false)

			console.log('User is opted out of basic Loophole metrics?', didOptOut)
			if (didOptOut) {
				this.client.optOut()
			}
			else {
				this.client.optIn()
				this.client.identify(identifyMessage)
			}

			console.log('Loophole posthog metrics info:', JSON.stringify(identifyMessage, null, 2))

			// mark ready and flush any events that arrived before storage was ready
			this._ready = true
			if (!didOptOut && !isDevMode) {
				this._flushPending()
				// Set up periodic flushing to ensure events are sent regularly
				this._flushInterval = setInterval(() => {
					try {
						this.client.flush()
					} catch (error) {
						console.error('Failed to flush PostHog events:', error)
					}
				}, FLUSH_INTERVAL_MS)
			}
			else {
				this._pendingCaptures = []
			}
		} catch (error) {
			console.error('Failed to initialize metrics service:', error)
			this._ready = true // Set ready to avoid blocking pending captures
		}
	}


	// queue captures that arrive before initialize() has resolved
	private _pendingCaptures: Array<{ event: string; params: Record<string, any> }> = []
	private _ready = false

	capture: IMetricsService['capture'] = (event, params) => {
		if (!this._ready) {
			this._pendingCaptures.push({ event, params })
			return
		}
		// In dev mode, just log the event instead of sending it
		if (this._isDevMode) {
			console.log('[PostHog Dev Mode] Would capture:', event, params)
			return
		}
		try {
			const distinctId = this.distinctId
			if (!distinctId) {
				console.error('Cannot capture event: distinctId not available', { event, params })
				return
			}
			this.client.capture({ distinctId, event, properties: { ...params, ...this._initProperties } })
		} catch (error) {
			console.error('Failed to capture metric event:', error, { event, params })
		}
	}

	private _flushPending() {
		const distinctId = this.distinctId
		if (!distinctId) {
			console.error('Cannot flush pending events: distinctId not available')
			this._pendingCaptures = []
			return
		}
		for (const { event, params } of this._pendingCaptures) {
			try {
				this.client.capture({ distinctId, event, properties: { ...params, ...this._initProperties } })
			} catch (error) {
				console.error('Failed to flush pending metric event:', error, { event, params })
			}
		}
		this._pendingCaptures = []
	}

	setOptOut: IMetricsService['setOptOut'] = (newVal: boolean) => {
		try {
			// persist to main-process storage so it survives restarts
			if (newVal) {
				this._appStorage.store(OPT_OUT_KEY, 'true', StorageScope.APPLICATION, StorageTarget.MACHINE)
				this.client.optOut()
			}
			else {
				this._appStorage.remove(OPT_OUT_KEY, StorageScope.APPLICATION)
				this.client.optIn()
			}
		} catch (error) {
			console.error('Failed to set opt-out status:', error, { newVal })
		}
	}

	override async dispose() {
		// Clear the flush interval
		if (this._flushInterval) {
			clearInterval(this._flushInterval)
			this._flushInterval = undefined
		}

		// flush any pending events before the process exits
		try {
			await this.client.shutdown()
		} catch (error) {
			console.error('Failed to shutdown PostHog client:', error)
		}
		super.dispose()
	}

	async getDebuggingProperties() {
		return {
			...this._initProperties,
			isReady: this._ready,
			pendingCaptures: this._pendingCaptures.length,
			clientInitialized: !!this.client,
		}
	}
}
