/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { KiloAgentEvent, KiloAgentPromptParams } from '../../common/kiloAgentTypes.js';
import { IKiloAgentService } from '../../common/kiloAgentService.js';
import { IEngineChatSink, IKiloAgentChatRunner, KiloAgentChatRunner } from '../kiloAgentChatRunner.js';
import { EngineEditOutcome, IKiloAgentDiffBridge } from '../kiloAgentDiffBridge.js';
import { IKiloIdeToolsService } from '../kiloIdeToolsService.js';

suite('KiloAgentChatRunner', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let runner: IKiloAgentChatRunner;
	let agentEvents: Emitter<KiloAgentEvent>;

	// what the fake agent service recorded
	let sent: KiloAgentPromptParams[];
	let aborted: string[];
	let permissionReplies: Array<{ requestID: string; reply: string }>;
	let staged: Array<{ directory: string; count: number }>;
	let nextDiffResult: EngineEditOutcome[];

	/** A recording IEngineChatSink. */
	class RecordingSink implements IEngineChatSink {
		threadId = 'thread-1';
		messages: any[] = [];
		running: Array<{ id: string; name: string }> = [];
		finished: Array<{ error?: { message: string } }> = [];
		addMessage = (m: any) => { this.messages.push(m); };
		finishTurn = (o: any = {}) => { this.finished.push(o); };
		setToolRunning = (t: { id: string; name: string }) => { this.running.push({ id: t.id, name: t.name }); };
		clearToolRunning = (id: string) => { this.running = this.running.filter(r => r.id !== id); };
	}

	let sink: RecordingSink;

	setup(() => {
		sent = [];
		aborted = [];
		permissionReplies = [];
		staged = [];
		nextDiffResult = [];
		sink = new RecordingSink();

		instantiationService = workbenchInstantiationService(undefined, disposables);

		agentEvents = disposables.add(new Emitter<KiloAgentEvent>());

		const agentService = {
			_serviceBrand: undefined,
			onDidReceiveEvent: agentEvents.event,
			onDidReceiveEventForDirectory: () => agentEvents.event,
			onDidChangeState: Event.None,
			state: { status: 'running' },
			ensureStarted: async () => { },
			prompt: async (p: KiloAgentPromptParams) => { sent.push(p); },
			abort: async (ref: { sessionID: string }) => { aborted.push(ref.sessionID); },
			replyPermission: async (p: { requestID: string; reply: string }) => { permissionReplies.push({ requestID: p.requestID, reply: p.reply }); },
			getDiff: async () => ([
				{ file: '/w/a.ts', status: 'modified', additions: 1, deletions: 1, before: 'x', after: 'y' },
			] as any),
		} as unknown as IKiloAgentService;
		instantiationService.stub(IKiloAgentService, agentService);

		instantiationService.stub(IKiloAgentDiffBridge, {
			_serviceBrand: undefined,
			stageAll: async ({ directory, diffs }: { directory: string; diffs: any[] }) => {
				staged.push({ directory, count: diffs.length });
				return nextDiffResult;
			},
			stageEdit: async () => ({ kind: 'staged', file: '' } as EngineEditOutcome),
		} as unknown as IKiloAgentDiffBridge);

		instantiationService.stub(IKiloIdeToolsService, {
			_serviceBrand: undefined,
			ensureRegistered: async () => { },
			stop: async () => { },
		} as unknown as IKiloIdeToolsService);

		// createInstance returns the concrete class; keep the disposable so it is torn down with the
// suite. No cast needed now that IKiloAgentChatRunner extends IDisposable.
		runner = disposables.add(instantiationService.createInstance(KiloAgentChatRunner));
	});

	/** Feeds one engine event, as the host would after normalizing it. */
	function emit(type: string, properties: Record<string, any>, directory = '/w') {
		agentEvents.fire({ directory, type, properties });
	}

	function startTurn(over: Partial<Parameters<IKiloAgentChatRunner['startTurn']>[0]> = {}) {
		return runner.startTurn({
			threadId: 'thread-1',
			sessionID: 'ses_1',
			directory: '/w',
			text: 'hello',
			sink,
			...over,
		} as any);
	}

	suite('sending a turn', () => {

		test('sends the prompt with the workspace directory', async () => {
			await startTurn();
			assert.strictEqual(sent.length, 1);
			assert.strictEqual(sent[0].text, 'hello');
			assert.strictEqual(sent[0].directory, '/w');
			assert.strictEqual(sent[0].sessionID, 'ses_1');
		});

		test('forwards the model and system text when given', async () => {
			await startTurn({
				model: { providerID: 'anthropic', modelID: 'claude' },
				system: 'follow the rules',
			});
			assert.deepStrictEqual(sent[0].model, { providerID: 'anthropic', modelID: 'claude' });
			assert.strictEqual(sent[0].system, 'follow the rules');
		});

		test('omits the model and system when not given', async () => {
			await startTurn();
			assert.strictEqual(sent[0].model, undefined);
			assert.strictEqual(sent[0].system, undefined);
		});

		test('always sends an editor context', async () => {
			await startTurn();
			const ctx = sent[0].editorContext;
			assert.ok(ctx, 'every turn must carry an editor context');
			assert.strictEqual(ctx!.directory, '/w');
		});

		test('remembers the session for the thread', async () => {
			await startTurn();
			assert.strictEqual(runner.sessionOf('thread-1'), 'ses_1');
		});

		test('forgets a thread on request', async () => {
			await startTurn();
			runner.forgetThread('thread-1');
			assert.strictEqual(runner.sessionOf('thread-1'), undefined);
		});
	});

	suite('streaming', () => {

		test('turns text parts into assistant messages', async () => {
			await startTurn();
			emit('message.part.updated', { part: { type: 'text', text: 'Hello', messageID: 'msg_1', sessionID: 'ses_1' } });
			assert.strictEqual(sink.messages.length, 1);
			assert.strictEqual(sink.messages[0].role, 'assistant');
			assert.strictEqual(sink.messages[0].displayContent, 'Hello');
		});

		test('ignores parts belonging to another session', async () => {
			await startTurn();
			emit('message.part.updated', { part: { type: 'text', text: 'other', messageID: 'm', sessionID: 'ses_other' } });
			assert.strictEqual(sink.messages.length, 0);
		});

		test('ignores global events', async () => {
			await startTurn();
			emit('message.part.updated', { part: { type: 'text', text: 'x', messageID: 'm', sessionID: 'ses_1' } }, 'global');
			assert.strictEqual(sink.messages.length, 0);
		});

		test('reports a tool start and then its completion', async () => {
			await startTurn();
			emit('message.part.updated', { part: { type: 'tool', id: 'prt_1', name: 'read', callID: 'call_1', state: { status: 'running', input: { filePath: '/w/a.ts' } }, sessionID: 'ses_1' } });
			assert.deepStrictEqual(sink.running, [{ id: 'call_1', name: 'read' }]);

			emit('message.part.updated', { part: { type: 'tool', id: 'prt_1', name: 'read', callID: 'call_1', state: { status: 'completed', input: {}, result: 'done' }, sessionID: 'ses_1' } });
			assert.deepStrictEqual(sink.running, [], 'the spinner is cleared');
			assert.strictEqual(sink.messages.at(-1).role, 'tool');
		});

		test('surfaces a tool failure as a tool_error message', async () => {
			await startTurn();
			emit('message.part.updated', { part: { type: 'tool', id: 'prt_1', name: 'bash', callID: 'call_1', state: { status: 'error', input: {}, error: { data: { message: 'boom' } } }, sessionID: 'ses_1' } });
			assert.strictEqual(sink.messages.at(-1).type, 'tool_error');
			assert.strictEqual(sink.messages.at(-1).content, 'boom');
		});

		test('renders the model plan from a todo event', async () => {
			await startTurn();
			emit('todo.updated', { sessionID: 'ses_1', todos: [{ content: 'read', status: 'completed' }, { content: 'edit', status: 'pending' }] });
			assert.strictEqual(sink.messages.at(-1).name, 'todowrite');
			assert.strictEqual(sink.messages.at(-1).content, 'x read\n  edit');
		});

		test('ignores an empty todo list', async () => {
			await startTurn();
			emit('todo.updated', { sessionID: 'ses_1', todos: [] });
			assert.strictEqual(sink.messages.length, 0);
		});
	});

	suite('ending a turn', () => {

		test('finishes when the session goes idle', async () => {
			await startTurn();
			emit('session.idle', { sessionID: 'ses_1' });
			assert.strictEqual(sink.finished.length, 1);
			assert.deepStrictEqual(sink.finished[0], {});
		});

		test('stages the engine edits once the turn ends', async () => {
			await startTurn();
			emit('session.idle', { sessionID: 'ses_1' });
			// endTurn is async; let the microtask queue drain
			await new Promise(r => setTimeout(r, 0));
			assert.deepStrictEqual(staged, [{ directory: '/w', count: 1 }]);
		});

		test('does not stage edits for another session', async () => {
			await startTurn();
			emit('session.idle', { sessionID: 'ses_other' });
			await new Promise(r => setTimeout(r, 0));
			assert.strictEqual(sink.finished.length, 0);
		});

		test('finishes only once even if idle fires twice', async () => {
			await startTurn();
			emit('session.idle', { sessionID: 'ses_1' });
			emit('session.idle', { sessionID: 'ses_1' });
			await new Promise(r => setTimeout(r, 0));
			assert.strictEqual(sink.finished.length, 1);
		});

		test('reports the engine error message', async () => {
			await startTurn();
			emit('session.error', { sessionID: 'ses_1', error: { data: { message: 'rate limited' } } });
			assert.strictEqual(sink.finished[0].error?.message, 'rate limited');
		});

		test('does not stage edits after an error', async () => {
			await startTurn();
			emit('session.error', { sessionID: 'ses_1', error: { message: 'boom' } });
			await new Promise(r => setTimeout(r, 0));
			assert.strictEqual(staged.length, 0);
		});

		test('tells the user when an edit could not be shown for review', async () => {
			nextDiffResult = [{ kind: 'unsaved-conflict', file: '/w/a.ts' }];
			await startTurn();
			emit('session.idle', { sessionID: 'ses_1' });
			await new Promise(r => setTimeout(r, 0));
			const last = sink.messages.at(-1);
			assert.strictEqual(last.role, 'assistant');
			assert.ok(last.displayContent.includes('/w/a.ts'), 'names the file it could not stage');
		});

		test('stays quiet when every edit was staged', async () => {
			nextDiffResult = [{ kind: 'staged', file: '/w/a.ts' }];
			await startTurn();
			emit('session.idle', { sessionID: 'ses_1' });
			await new Promise(r => setTimeout(r, 0));
			assert.strictEqual(sink.messages.length, 0);
		});
	});

	suite('permissions', () => {

		function askPermission() {
			emit('permission.asked', {
				id: 'per_1', sessionID: 'ses_1', permission: 'bash', patterns: ['rm -rf /'],
				tool: { callID: 'call_1', messageID: 'msg_1' },
			});
		}

		test('shows the approval affordance', async () => {
			await startTurn();
			askPermission();
			const last = sink.messages.at(-1);
			assert.strictEqual(last.type, 'tool_request');
			assert.strictEqual(last.content, 'Allow bash?');
		});

		test('does not end the turn while an approval is outstanding', async () => {
			// The engine goes idle because it is blocked, not because it is done.
			await startTurn();
			askPermission();
			emit('session.idle', { sessionID: 'ses_1' });
			assert.strictEqual(sink.finished.length, 0);
		});

		test('approving replies "once", never "always"', async () => {
			// "always" would silently widen the engine's permissions for the rest of the session.
			await startTurn();
			askPermission();
			await runner.resolveApproval('thread-1', 'accept');
			assert.deepStrictEqual(permissionReplies, [{ requestID: 'per_1', reply: 'once' }]);
		});

		test('rejecting replies "reject"', async () => {
			await startTurn();
			askPermission();
			await runner.resolveApproval('thread-1', 'reject');
			assert.deepStrictEqual(permissionReplies, [{ requestID: 'per_1', reply: 'reject' }]);
		});

		test('acting twice does not send two replies', async () => {
			await startTurn();
			askPermission();
			await runner.resolveApproval('thread-1', 'accept');
			await runner.resolveApproval('thread-1', 'accept');
			assert.strictEqual(permissionReplies.length, 1);
		});

		test('does nothing when there is no approval pending', async () => {
			await startTurn();
			await runner.resolveApproval('thread-1', 'accept');
			assert.strictEqual(permissionReplies.length, 0);
		});

		test('does nothing for a thread with no turn', async () => {
			await runner.resolveApproval('nope', 'accept');
			assert.strictEqual(permissionReplies.length, 0);
		});

		test('ignores a permission request for another session', async () => {
			await startTurn();
			emit('permission.asked', { id: 'per_1', sessionID: 'ses_other', permission: 'bash' });
			assert.strictEqual(sink.messages.length, 0);
		});

		test('clears a pending request once the engine reports it replied', async () => {
			await startTurn();
			askPermission();
			emit('permission.replied', { requestID: 'per_1', sessionID: 'ses_1', reply: 'once' });
			await runner.resolveApproval('thread-1', 'accept');
			assert.strictEqual(permissionReplies.length, 0, 'already handled by the engine');
		});
	});

	suite('aborting', () => {

		test('aborts the engine session', async () => {
			await startTurn();
			await runner.abort('thread-1');
			assert.deepStrictEqual(aborted, ['ses_1']);
		});

		test('finishes the turn', async () => {
			await startTurn();
			await runner.abort('thread-1');
			assert.strictEqual(sink.finished.length, 1);
		});

		test('does not stage edits, since the turn is incomplete', async () => {
			await startTurn();
			await runner.abort('thread-1');
			await new Promise(r => setTimeout(r, 0));
			assert.strictEqual(staged.length, 0);
		});

		test('is a no-op for a thread with no turn', async () => {
			await runner.abort('nope');
			assert.strictEqual(aborted.length, 0);
		});

		test('clears a pending approval so a later idle can end the turn', async () => {
			await startTurn();
			emit('permission.asked', { id: 'per_1', sessionID: 'ses_1', permission: 'bash', tool: { callID: 'call_1' } });
			await runner.abort('thread-1');
			emit('session.idle', { sessionID: 'ses_1' });
			await new Promise(r => setTimeout(r, 0));
			assert.strictEqual(sink.finished.length, 1);
		});
	});
});
