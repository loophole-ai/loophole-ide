# Loophole CLI — IDE backend

Loophole IDE is a VS Code (Void) fork. The AI backend is the **Loophole CLI**: the same
`loophole-cli` binary that ships with the app and as an npm package. The IDE starts it
locally and drives it over its loopback API, so the editor, the CLI and the desktop app all
run the same engine and share the same providers, models and sessions.

Nothing in the editor is user-visible as a "server": the only concept in the UI is **CLI**.

## Where things live

| File | Role |
|---|---|
| `common/loopholeCliTypes.ts` | shared command/params/types |
| `common/loopholeCliService.ts` | renderer-side service (`ILoopholeCliService`), registered singleton |
| `electron-main/loopholeCliChannel.ts` | main-process `IServerChannel`: spawns the binary, owns auth, exposes commands |
| `electron-main/llmMessage/loopholeCliChat.ts` | chat turns: session create → prompt → event stream → callbacks |
| `browser/react/src/void-settings-tsx/cli-settings/` | settings pages (Models, Providers, Autocomplete, Context, Commit Message, Notifications, Status, About) |

IPC channel name: `void-channel-loopholeCli`.

## Connection lifecycle

1. The renderer calls `connect()` (settings Status page, or automatically on sidebar mount).
2. The main process resolves the binary:
   1. `LOOPHOLE_CLI_BIN` env override
   2. `<app>/resources/app/bin/loophole(.exe)`
   3. `<app>/resources/loophole-cli(.exe)` — where the packaging step drops it
   4. `loophole-cli` / `loophole` on `PATH`
3. It picks a free loopback port, generates a per-launch password, exports it to the child
   as `OPENCODE_SERVER_PASSWORD` (the CLI refuses to boot without one), and spawns
   `loophole-cli serve --port <n> --hostname 127.0.0.1`.
4. Readiness is confirmed by polling a real endpoint with Basic auth (`loophole:<password>`).
5. `status()` reports `connected | starting | disconnected | error`, port, pid, binary path
   and the last error — this is what the Status page renders.

## Commands exposed to the renderer

`connect`, `disconnect`, `status`, `providers`, `models`, `defaultModel`, `integrations`,
`connectKey`, `credentialRemove`, `configUpdate`, `sessions`, `sessionGet`,
`sessionMessages`, `sessionContext`, `sessionCreate`, `sessionDelete`, `sessionFork`,
`sessionRename`, `commands`, `skills`, `runCommand`, `activateSkill`, `revertStage`,
`revertClear`, `revertCommit`, `permissionList`, `fim`, `fimAbort`, `voiceModels`,
`voiceSession`, `voiceWsConnect`, `voiceWsSend`, `voiceWsClose`.

## Settings

The CLI owns provider and model configuration. The editor stores only role assignments:

| Setting | Meaning |
|---|---|
| `loophole.cli.enabled` | use the CLI backend (default `true`) |
| `loophole.cli.model` | current selection, `providerID/modelID` |
| `loophole.cli.models.default` | chat, agents, apply |
| `loophole.cli.models.small` | fast/cheap requests |
| `loophole.cli.models.subagent` | delegated subagent work |
| `loophole.cli.models.autocompletion` | inline completions |
| `loophole.cli.models.speechToText` | voice input |
| `loophole.cli.models.commitMessage` | generated commit messages |
| `loophole.fim.*` | autocomplete transport (Mercury Edit 2) |

## Syncing the CLI

The CLI source is the `loophole` branch of `loophole-ai/loophole-app`. See that repo's
`PATCHES.md` for the merge flow.
