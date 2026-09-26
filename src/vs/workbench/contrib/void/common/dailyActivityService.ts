/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';

/**
 * Counts how many chat messages were sent per day, so the empty-editor screen can
 * render an activity heatmap.
 *
 * This is deliberately local-only: the counts live in the profile's storage and are
 * never sent anywhere. Only a day -> count map is kept, never message content.
 */
export interface IDailyActivityService {
	readonly _serviceBrand: undefined;

	/** Counts keyed by local `YYYY-MM-DD`. */
	readonly state: { readonly [day: string]: number };

	/** Bumped whenever `state` changes, so React can subscribe. */
	readonly onDidChange: Event<{ readonly [day: string]: number }>;

	/** Records one activity for today. */
	recordActivity(count?: number): void;

	/** Number of recorded activities today. */
	getTodayCount(): number;
}

export const IDailyActivityService = createDecorator<IDailyActivityService>('dailyActivityService');

const STORAGE_KEY = 'void.dailyActivity.v1';

/**
 * How many days of history we keep. The empty-editor heatmap shows a full year
 * (53 weeks = 371 days), so keep a little more than that to cover the
 * Monday-aligned column padding at the edges of the grid.
 */
const MAX_DAYS = 400;

export const dayKeyOf = (date: Date = new Date()): string => {
	// local time, not UTC - the heatmap is a local-time calendar
	const y = date.getFullYear();
	const m = `${date.getMonth() + 1}`.padStart(2, '0');
	const d = `${date.getDate()}`.padStart(2, '0');
	return `${y}-${m}-${d}`;
};

export class DailyActivityService extends Disposable implements IDailyActivityService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<{ readonly [day: string]: number }>());
	readonly onDidChange = this._onDidChange.event;

	private _state: { readonly [day: string]: number };
	get state() { return this._state; }

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._state = this._read();
	}

	private _read(): { [day: string]: number } {
		const raw = this.storageService.get(STORAGE_KEY, StorageScope.PROFILE);
		if (!raw) return {};
		try {
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
			const out: { [day: string]: number } = {};
			for (const [day, count] of Object.entries(parsed)) {
				if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
					out[day] = Math.floor(count);
				}
			}
			return out;
		} catch {
			// corrupt storage should never break startup
			return {};
		}
	}

	private _write(next: { [day: string]: number }) {
		// drop anything outside the retention window so storage can't grow forever
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - MAX_DAYS);
		const cutoffKey = dayKeyOf(cutoff);
		for (const day of Object.keys(next)) {
			if (day < cutoffKey) delete next[day];
		}
		this._state = next;
		this.storageService.store(STORAGE_KEY, JSON.stringify(next), StorageScope.PROFILE, StorageTarget.MACHINE);
		this._onDidChange.fire(next);
	}

	recordActivity(count: number = 1) {
		const day = dayKeyOf();
		const next = { ...this._state };
		next[day] = (next[day] ?? 0) + count;
		this._write(next);
	}

	getTodayCount(): number {
		return this._state[dayKeyOf()] ?? 0;
	}
}

registerSingleton(IDailyActivityService, DailyActivityService, InstantiationType.Delayed);
