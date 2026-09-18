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

	private readonly client: PostHog

	private _initProperties: object = {}


	// helper - looks like this is stored in a .vscdb file in ~/Library/Application Support/Loophole
	private _memoStorage(key: string, target: StorageTarget, setValIfNotExist?: string) {
		const currVal = this._appStorage.get(key, StorageScope.APPLICATION)
		if (currVal !== undefined) return currVal
		const newVal = setValIfNotExist ?? generateUuid()
		this._appStorage.store(key, newVal, StorageScope.APPLICATION, target)
		return newVal
	}


	// this is old, eventually we can just delete this since all the keys will have been transferred over
	// returns 'NULL' or the old key
	private get oldId() {
		// check new storage key first
		const newKey = 'loophole.app.oldMachineId'
		const newOldId = this._appStorage.get(newKey, StorageScope.APPLICATION)
		if (newOldId) return newOldId

		// put old key into new key if didn't already
		const oldValue = this._appStorage.get('void.machineId', StorageScope.APPLICATION) ?? 'NULL' // the old way of getting the key
		this._appStorage.store(newKey, oldValue, StorageScope.APPLICATION, StorageTarget.MACHINE)
		return oldValue

		// in a few weeks we can replace above with this
		// private get oldId() {
		// 	return this._memoStorage('loophole.app.oldMachineId', StorageTarget.MACHINE, 'NULL')
		// }
	}


	// the main id
	private get distinctId() {
		const oldId = this.oldId
		const setValIfNotExist = oldId === 'NULL' ? undefined : oldId
		return this._memoStorage('loophole.app.machineId', StorageTarget.MACHINE, setValIfNotExist)
	}

	// just to see if there are ever multiple machineIDs per userID (instead of this, we should just track by the user's email)
	private get userId() {
		return this._memoStorage('loophole.app.userMachineId', StorageTarget.USER)
	}

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IApplicationStorageMainService private readonly _appStorage: IApplicationStorageMainService,
	) {
		super()
		this.client = new PostHog('phc_oTDpdDZgxMUvGmfGoJMEKhazigTNMFeqSFb8zmH698wy', {
			host: 'https://us.i.posthog.com',
		})

		this.initialize() // async
	}

	async initialize() {
		// very important to await whenReady!
		await this._appStorage.whenReady

		const { commit, version, loopholeVersion, loopholeRelease, quality } = this._productService

		const isDevMode = !this._envMainService.isBuilt // found in abstractUpdateService.ts

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
		if (!didOptOut) {
			this._flushPending()
		}
		else {
			this._pendingCaptures = []
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
		this.client.capture({ distinctId: this.distinctId, event, properties: { ...params, ...this._initProperties } })
	}

	private _flushPending() {
		for (const { event, params } of this._pendingCaptures) {
			this.client.capture({ distinctId: this.distinctId, event, properties: { ...params, ...this._initProperties } })
		}
		this._pendingCaptures = []
	}

	setOptOut: IMetricsService['setOptOut'] = (newVal: boolean) => {
		// persist to main-process storage so it survives restarts
		if (newVal) {
			this._appStorage.store(OPT_OUT_KEY, 'true', StorageScope.APPLICATION, StorageTarget.MACHINE)
			this.client.optOut()
		}
		else {
			this._appStorage.remove(OPT_OUT_KEY, StorageScope.APPLICATION)
			this.client.optIn()
		}
	}

	override async dispose() {
		// flush any pending events before the process exits
		await this.client.shutdown()
		super.dispose()
	}

	async getDebuggingProperties() {
		return this._initProperties
	}
}
