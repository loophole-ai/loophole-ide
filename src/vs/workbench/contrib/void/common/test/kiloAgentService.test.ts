/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IKiloAgentService, KiloAgentService } from '../kiloAgentService.js';
import { KILO_AGENT_CHANNEL, type KiloAgentEvent, type KiloAgentHostState } from '../kiloAgentTypes.js';

suite('KiloAgentService', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let service: IKiloAgentService;
	let calls: Array<{ command: string; params: unknown }>;
	let stateEmitter: Emitter<KiloAgentHostState>;
	let eventEmitter: Emitter<KiloAgentEvent>;
	let callImpl: (command: string, params: unknown) => Promise<unknown>;

	setup(() => {
		calls = [];
		stateEmitter = disposables.add(new Emitter<KiloAgentHostState>());
		eventEmitter = disposables.add(new Emitter<KiloAgentEvent>());
		// getState must answer with a real state object; ensureStarted assigns it straight to _state.
		callImpl = async (command) => command === 'getState' ? { status: 'running' } : undefined;

		instantiationService = disposables.add(new TestInstantiationService(workbenchInstantiationService));
		instantiationService.stub(IMainProcessService, {
			_serviceBrand: undefined,
			getChannel: (name: string) => {
				assert.strictEqual(name, KILO_AGENT_CHANNEL);
				return {
					call: async (command: string, params: unknown) => {
						calls.push({ command, params });
						return callImpl(command, params);
					},
					listen: (event: string) => {
						if (event === 'onState') return stateEmitter.event;
						if (event === 'onEvent') return eventEmitter.event;
						throw new Error(`unexpected listen: ${event}`);
					},
				};
			},
		} as unknown as IMainProcessService);

		service = disposables.add(instantiationService.createInstance(KiloAgentService) as unknown as IKiloAgentService);
	});

	suite('ensureStarted', () => {

		test('starts a stopped engine and adopts the reported state', async () => {
			await service.ensureStarted();
			assert.deepStrictEqual(calls.map(c => c.command), ['start', 'getState']);
			assert.strictEqual(service.state.status, 'running');
		});

		test('is a no-op when already running', async () => {
			stateEmitter.fire({ status: 'running' });
			await service.ensureStarted();
			assert.deepStrictEqual(calls, [], 'must not spawn a second engine');
		});

		test('starts again after a failure state', async () => {
			stateEmitter.fire({ status: 'error', message: 'boom' });
			await service.ensureStarted();
			assert.deepStrictEqual(calls.map(c => c.command), ['start', 'getState']);
		});

		test('starts again after an explicit stop', async () => {
			stateEmitter.fire({ status: 'running' });
			await service.stop();
			stateEmitter.fire({ status: 'stopped' });
			await service.ensureStarted();
			assert.deepStrictEqual(calls.map(c => c.command), ['stop', 'start', 'getState']);
		});

		test('propagates a start failure to the caller', async () => {
			callImpl = async () => { throw new Error('binary not found'); };
			await assert.rejects(() => service.ensureStarted(), /binary not found/);
		});

		test('leaves state untouched when start rejects', async () => {
			callImpl = async () => { throw new Error('nope'); };
			await service.ensureStarted().catch(() => { });
			assert.strictEqual(service.state.status, 'stopped');
		});

		test('surfaces the engine error message from the host', async () => {
			callImpl = async (command) => command === 'getState' ? { status: 'error', message: 'binary not found' } : undefined;
			await service.ensureStarted();
			assert.strictEqual(service.state.message, 'binary not found');
		});
	});

	suite('state events', () => {

		test('republishes host state', () => {
			const seen: KiloAgentHostState[] = [];
			disposables.add(service.onDidChangeState(s => seen.push(s)));
			stateEmitter.fire({ status: 'starting' });
			stateEmitter.fire({ status: 'running' });
			assert.deepStrictEqual(seen.map(s => s.status), ['starting', 'running']);
		});
	});

	suite('event routing', () => {

		test('delivers events for every directory', () => {
			const seen: KiloAgentEvent[] = [];
			disposables.add(service.onDidReceiveEvent(e => seen.push(e)));
			eventEmitter.fire({ directory: '/a', type: 'message.part.updated', properties: {} });
			eventEmitter.fire({ directory: '/b', type: 'message.part.updated', properties: {} });
			assert.strictEqual(seen.length, 2);
		});

		test('filters by directory', () => {
			const seen: KiloAgentEvent[] = [];
			disposables.add(service.onDidReceiveEventForDirectory('/a')(e => seen.push(e)));
			eventEmitter.fire({ directory: '/a', type: 'x', properties: {} });
			eventEmitter.fire({ directory: '/b', type: 'x', properties: {} });
			assert.strictEqual(seen.length, 1);
			assert.strictEqual(seen[0].directory, '/a');
		});
	});

	suite('command mapping', () => {

		test('passes the session ref through for edit routes', async () => {
			await service.getDiff({ directory: '/w', sessionID: 'ses_1' });
			assert.deepStrictEqual(calls[0], { command: 'getDiff', params: { directory: '/w', sessionID: 'ses_1' } });
		});

		test('builds an ide tools start command from a directory list', async () => {
			await service.startIdeToolsServer(['/w', '/w2']);
			assert.deepStrictEqual(calls[0], { command: 'startIdeToolsServer', params: { directories: ['/w', '/w2'] } });
		});

		test('stopIdeToolsServer takes no params', async () => {
			await service.stopIdeToolsServer();
			assert.deepStrictEqual(calls[0], { command: 'stopIdeToolsServer', params: undefined });
		});

		test('setAuth sends the provider id and key', async () => {
			await service.setAuth({ providerID: 'mistral', key: 'sk-test' });
			assert.deepStrictEqual(calls[0], { command: 'setAuth', params: { providerID: 'mistral', key: 'sk-test' } });
		});
	});
});