# Agent engine notes (Kilo CLI `serve`)

Everything in this file was read out of the Kilo source checkout at `D:\Loophole\kilocode`
rather than guessed. Where a fact could not be established from source, it is marked
**UNVERIFIED** and needs a live run.

The engine is `@kilocode/cli` (MIT), pinned to `7.8.3`. Its CLI is a fork of OpenCode. Loophole
never edits it — only config, env vars, and MCP.

## The engine is the only agent

There is no backend toggle. `chatThreadService` drives the engine on every turn; the built-in
Loophole agent loop (`_runChatAgent`, `_runToolCall`) and its tool-execution path were removed,
along with the `agentEngine` setting and the `approveLatestToolRequest` / `abortRunning` branches
that used to dispatch to it. Approvals now go to the engine's permission API and aborts are a
`POST /session/{id}/abort` round trip.

This is a deliberate reversal of the original brief, which asked for the legacy agent to stay
available behind a setting as a fallback. There is no fallback now: if the engine fails to start,
the chat sidebar reports an error and nothing runs.

### What survived the removal, and why

Deleting the agent did **not** mean deleting these, because they are not the agent loop:

| Kept | Why |
|---|---|
| `editCodeService` | the diff zones and accept/reject UI — the engine path *depends* on it |
| `autocompleteService` | inline autocomplete, a separate FIM feature, not agent-driven |
| `sendLLMMessageService` / channel | still used by autocomplete, Quick Edit streaming, SCM commit messages, and model refresh |
| `convertToLLMMessageService` | `prepareFIMMessage` for autocomplete; `getCombinedAIInstructions` for the engine's `system` |
| `prompts.ts`, `toolsServiceTypes.ts` | Quick Edit prompts, terminal limits, SCM prompts, and the sidebar's tool types all read from them |
| `toolsService.ts` | **only** for `generateCodespanLink`'s filename search, and for the React sidebar's legacy tool-result formatting. No agent tool is executed through it any more. |

### Known leftovers from the removal

1. **The "Auto-approve <tool>" switches in Settings are now inert.** `autoApprove` drove the
   legacy loop's approval gate. The engine's permissions are configured through
   `PUT /permission/{id}/reply` and the agent's own rules, so those switches do nothing. They
   should be removed, along with the `ToolApprovalType` plumbing in `SidebarChat.tsx`.
2. **`toolsService.ts` should be deleted**, which requires replacing the codespan filename search
   and the sidebar's `stringOfResult[...]` formatting. Both live in React code that was not
   touched here because it could not be compiled or tested.
3. `chatThreadServiceTypes.ts` still declares the legacy `ToolMessage` variants, some of which are
   now only produced by the engine projection.


## Where the engine lives

| Concern | File |
|---|---|
| `serve` command, port line | `packages/opencode/src/cli/cmd/serve.ts:24` |
| Env / feature flags | `packages/core/src/flag/flag.ts` |
| Route paths (classic family) | `packages/opencode/src/server/routes/instance/httpapi/groups/*.ts` |
| Global routes | `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts` |
| `/global/event` emitter | `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts:28` |
| Per-project `/event` emitter | `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts` |
| `EditorContext` | `packages/opencode/src/kilocode/editor-context.ts` |
| `PromptInput` | `packages/opencode/src/session/prompt.ts:2505` |
| `SnapshotFileDiff` | `packages/schema/src/file-diff.ts` |
| MCP config shapes | `packages/core/src/v1/config/mcp.ts` |
| Telemetry switch | `packages/kilo-telemetry/src/telemetry.ts:89` |
| Config merge/update | `packages/opencode/src/config/config.ts:1100` |

## Startup

`kilo serve --port 0` prints `kilo server listening on <url>` on stdout. The port is always
parsed, never assumed.

Auth is HTTP Basic. `KILO_SERVER_PASSWORD` and `KILO_SERVER_USERNAME` (default `kilo`); without
a password the engine runs unsecured, so Loophole always sets a random 32-byte hex password per
launch. **The password and port never leave the main process** — the renderer reaches the engine
only through the `void-channel-kilo-agent` IPC channel.

### Environment set at spawn

| Var | Value | Why |
|---|---|---|
| `KILO_SERVER_USERNAME` / `KILO_SERVER_PASSWORD` | `kilo` / random 32-byte hex | localhost auth |
| `KILO_TELEMETRY_LEVEL` | `off` | PostHog is enabled by `all`; anything else disables it |
| `KILO_DISABLE_AUTOUPDATE` | `1` | the engine must not replace the pinned binary |
| `KILO_DISABLE_EMBEDDED_WEB_UI` | `1` | we never use its web UI |
| `KILO_CONFIG_DIR` | `<userDataPath>/kilo-engine/config` | isolates the engine from the user's own Kilo install |
| `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_CACHE_HOME` / `XDG_STATE_HOME` | same tree | belt and braces; verified on Linux |
| `KILO_CONFIG_CONTENT` | JSON | locked-down baseline config |

`HOME` is deliberately **not** changed: the agent shells out to `git`, `ssh` and `npm`, which
need the real environment.

There is also a `POST /global/upgrade` route that replaces the engine binary. The host channel
never calls it. See "Supply chain" below.

## Locked-down config

```jsonc
{
  "autoupdate": false,
  "disabled_providers": ["kilo"],
  "snapshot": true,      // required for GET /session/{id}/diff and revert
  "share": "disabled"
}
```

`disabled_providers` is unioned with anything a caller supplies, so it cannot be removed.
Disabling the `kilo` provider matters: it is Kilo's hosted gateway, and Loophole must never
send the user's code to Kilo's servers.

## Directory addressing

Most routes take `?directory=<abs path>`; the engine also accepts an `x-kilo-directory`
header and falls back to `process.cwd()` (`middleware/workspace-routing.ts:88`). Loophole always
passes `?directory=` explicitly. One server can serve several workspaces.

## Verified routes used

| Route | Notes |
|---|---|
| `GET /global/health` | `{ healthy, version }` |
| `GET /global/event` | SSE. Frames are `{directory, project?, payload:{id,type,properties}}`. First frame is `server.connected` with no `directory`; a `server.heartbeat` arrives every 10s. |
| `GET/PATCH /global/config` | **Global** config. Safe to write. |
| `PATCH /config` | ⚠️ **Writes into the user's repository** (creates `.kilo/kilo.jsonc`). Not used — see below. |
| `POST /session` | create |
| `GET /session` | list |
| `GET /session/{id}` | get |
| `DELETE /session/{id}` | delete |
| `GET /session/{id}/message` | `[{info, parts}]` |
| `GET /session/{id}/todo` | plan |
| `GET /session/{id}/diff` | `SnapshotFileDiff[]` — see below |
| `POST /session/{id}/prompt_async` | returns immediately; the reply streams over `/global/event` |
| `POST /session/{id}/abort` | stop a turn |
| `POST /session/{id}/revert` / `/unrevert` | undo a message's effects |
| `GET /permission`, `POST /permission/{id}/reply` | `{reply: "once"\|"always"\|"reject", message?}` |
| `GET /question`, `POST /question/{id}/reply`, `/reject` | `{answers: string[][]}` — one entry per question, in order |
| `GET /indexing/status`, `/indexing/models` | index progress |
| `GET /config/providers` | `{providers, default}` |
| `PUT/DELETE /auth/{providerID}` | store/remove a provider key |
| `GET /mcp`, `POST /mcp` | **`POST /mcp` is the runtime MCP registration route**: body is `{name, config}`. This settles an open question in the original brief. |

### Why not `PATCH /config`

`Config.update` (config.ts:1100) delegates to `KilocodeConfig.updateProjectConfig`, which writes
to the workspace's own config file — creating `<workspace>/.kilo/kilo.jsonc` if none exists
(kilocode/config/config.ts:76). Indexing, providers and permissions are per-user preferences, not
repository content, so Loophole patches `/global/config` instead and never touches the repo.

## Diff shape — and why the diff bridge is tractable

```ts
{ file, patch?, before?, after?, additions, deletions, status?: "added"|"deleted"|"modified" }
```

Two corrections to the original brief:

1. The field is **`file`**, not `path`.
2. The engine returns **full `before` and `after` content**, not just a patch.

(2) is the important one. A Loophole diff zone stores as its `originalCode` whatever the text
model held when the zone was created, so as long as the model is put back to `before` *before*
the zone is created, rejecting restores the original file exactly. The bridge in
`browser/kiloAgentDiffBridge.ts` does exactly that, which is why it does not need to take its
own pre-edit snapshots.

The race this has to handle: the engine writes straight to disk, and VS Code silently reloads a
clean buffer when its file changes underneath it. By the time we hear about the edit the buffer
may already hold the new content. Rewriting the model to `before` first covers both that case
and the new-file case.

## Event stream

The engine carries **two** payload shapes on the same stream: the legacy bus uses
`{id, type, properties}` and the newer EventV2 bus uses `{id, type, data}`. The host channel
normalizes with `properties ?? data` so the renderer only sees one shape. `server.heartbeat`
frames are dropped in the host.

Types the chat UI consumes: `message.part.updated`, `message.part.delta`, `permission.asked`,
`permission.replied`, `todo.updated`, `session.error`, `session.idle`. Everything else is
ignored rather than treated as an error.

Part types: `text`, `reasoning`, `tool`, `step-start`, `step-finish`, `file`, `snapshot`,
`patch`, `retry`, `compaction`, `agent`, `subtask`. Only the first three have a sidebar
representation today.

A tool part is `{id, name, state}` where `state.status` is `pending | running | completed | error`
(note: the field is `name`, not `tool`).

## IDE tools via MCP

The engine cannot see IDE diagnostics or the sidebar's persistent terminals, so Loophole runs a
small JSON-RPC-over-HTTP MCP server and registers it as a `remote` transport:

```ts
{ name: 'loophole', config: { type: 'remote', url, headers: { authorization: 'Bearer <token>' } } }
```

`remote` with `url` + `headers` is confirmed in `packages/core/src/v1/config/mcp.ts:80`. The
server binds `127.0.0.1:0` with a random bearer token.

Tools exposed: `read_diagnostics` (replaces the legacy `read_lint_errors`),
`list_terminals`, `run_in_terminal`, `read_terminal`, `kill_terminal`.

### The listener MUST be in electron-main, not browser/

An earlier version ran this server from `browser/kiloIdeToolsService.ts` and booted to a black
screen. The trap is that **the build gives no warning**:

- The workbench bundle is built with `platform: 'neutral'` + `packages: 'external'`
  (`build/next/index.ts:846-849`), so `import ... from 'http'` is left as a **bare specifier**
  in the ESM output rather than bundled or shimmed.
- `scripts/check-bare-imports.js` in loophole-builder resolves those specifiers against **Node**,
  where `http` and `crypto` are real builtins. It therefore reports "101 specifiers, all
  resolvable" and passes.
- At runtime the renderer loads that ESM with `import()`. Its import map only covers npm
  packages, not Node builtins, so the import rejects and the workbench never finishes loading.

So the typechecker passing (`build/checker/tsconfig.browser.json` sets `types: []`, which does
*not* stop `import 'http'`) and the bare-import check passing both fail to catch this.

Consequences for how this is split:

- `electron-main/kiloIdeToolsServer.ts` owns the socket, the bearer token and the MCP protocol.
  Node builtins are legitimate there.
- `browser/kiloIdeToolsService.ts` implements the tools only (`IMarkerService` and
  `ITerminalToolService` exist solely in the renderer) and registers a channel via
  `IMainProcessService.registerChannel`, which is how main calls *into* a renderer.
- `common/kiloIdeToolsProtocol.ts` holds the tool list and `handleMcpRequest`, so the protocol is
  unit-testable with no socket and no Electron.

Same rule applies to `process.platform` in `browser/` - use `isWindows` from
`base/common/platform.js` instead.

## Rules

`AGENTS.md` is read natively by the engine — nothing to do. `.loopholerules` and the project
memory that the legacy agent used are **not**; Loophole merges them into the per-turn `system`
field via `IConvertToLLMMessageService.getCombinedAIInstructions()`.

## Engine tools available in place of the legacy ones

`read_file`/`ls_dir` → `read`; `get_dir_tree`/`search_pathnames_only` → `glob`;
`search_for_files`/`search_in_file` → `grep`; `edit_file` → `edit`;
`create_file_or_folder`/`rewrite_file` → `write`; `run_command` → `bash`; `todo_write` →
`todowrite`; `read_lint_errors` → `loophole_read_diagnostics`. Persistent terminals →
`loophole_*_terminal` tools. Deletion goes through `bash`.

Plus `semantic_search`, which the legacy agent had no equivalent of.

## Supply chain

- Version pinned exactly (`7.8.3`, no `^`) in `package.json` and mirrored in
  `KILO_ENGINE_VERSION`.
- `KILO_DISABLE_AUTOUPDATE=1` plus `autoupdate: false`.
- The host channel never calls `POST /global/upgrade`.
- The Kilo provider is disabled by default, so no prompt or source is routed to Kilo.

## Code layout

Everything that touches the engine is in one place per layer, and the parts worth testing are
pure functions with no service imports:

| File | Layer | Role |
|---|---|---|
| `electron-main/kiloAgentHostChannel.ts` | main | **the only file that speaks HTTP to the engine**: spawn, supervise, auth, one SSE connection, one handler per command |
| `common/kiloAgentTypes.ts` | common | wire types shared across the IPC boundary |
| `common/kiloAgentEngineParsing.ts` | common | pure: SSE framing, event normalization, port parsing, config merge |
| `common/kiloAgentDiffDecision.ts` | common | pure: what to do with one engine edit |
| `common/kiloAgentProjection.ts` | common | pure: engine message part -> sidebar `ChatMessage` |
| `common/kiloAgentEngineMapping.ts` | common | pure: Loophole provider settings -> engine providers/indexing |
| `common/kiloAgentService.ts` | renderer | typed IPC wrapper; never sees the port or password |
| `common/kiloAgentConfigSync.ts` | renderer | pushes settings into the engine when they change |
| `browser/kiloAgentChatRunner.ts` | renderer | drives one turn, projects events onto the sidebar |
| `browser/kiloAgentDiffBridge.ts` | renderer | the I/O half of staging an edit as a diff zone |
| `browser/kiloIdeToolsService.ts` | renderer | localhost MCP server exposing diagnostics + terminals |

The four `common/` modules hold the logic most likely to break, so they are the ones with unit
tests (see below); the service layers around them are thin enough to read.

## Tests

`src/vs/workbench/contrib/void/common/test/` and `browser/test/`:

| File | Covers |
|---|---|
| `kiloAgentEngineParsing.test.ts` | frame splitting across chunk boundaries, the `properties`/`data` normalization, heartbeat filtering, port parsing, and that the locked-down config cannot be overridden by a caller |
| `kiloAgentDiffDecision.test.ts` | the staging decision and its ordering — in particular that a buffer VS Code already reloaded is reported as a no-op rather than blanked, and that unsaved work is never overwritten |
| `kiloAgentProjection.test.ts` | part -> `ChatMessage` mapping, delta vs. replace, tool start/complete/error, permission requests, todos |
| `kiloAgentEngineMapping.test.ts` | provider id mapping, credential collection, and that the `kilo` embedding provider is refused |
| `kiloAgentChatRunner.test.ts` | turn lifecycle end to end against a fake agent: streaming, idle, abort, permission approve/reject, and diff staging on turn end |

No mocha glob configuration is needed; VS Code discovers `out/**/*.test.js`.

The four `common/` suites are node-layer and run with `npm run test-node`.
`kiloAgentChatRunner.test.ts` uses the workbench instantiation service, so it is a browser-layer
suite: `npm run test-browser-no-install` (or `test-browser`, which also installs Playwright).

These tests were written but **not executed** in this environment: the checkout had no
`node_modules` and no `out/`, and installing + compiling was out of scope for the session. Treat
them as unrun until someone runs the suite.

## Provider ids — only these ever connect

`PUT /auth/{id}` answers **200 for any id**, including ones the engine does not know. The only
trustworthy signal is whether the id appears in `GET /provider` -> `connected`. (`GET /provider`
returns `{all, default, connected[], failed[]}`; `failed` distinguishes "key rejected" from "not
a real provider". Note `GET /config/providers` is a different, older route and does not carry
`connected`.)

Verified catalog ids: `openai`, `anthropic`, `google`, `xai`, `mistral`, `groq`, `deepseek`,
`openrouter`, `amazon-bedrock`, `lmstudio`, `azure`, `google-vertex`.

Two traps:

- **`bedrock` is wrong; it is `amazon-bedrock`.** The PUT succeeds and the key is stored, but the
  provider never connects. `ENGINE_AUTH_MAPPING` uses `amazon-bedrock`.
- **Plain `ollama` is not in the catalog** (only `ollama-cloud` is). A local Ollama server must be
  declared as a custom `openai-compatible` entry with its base URL, which is how `kiloAgentEngineMapping`
  treats it — along with vLLM, MLX, Apple Foundation Models, LiteLLM and the generic
  OpenAI-compatible provider.

Every `PUT` is therefore followed by a `GET /provider` check, and the settings UI surfaces the
per-provider failure (`classifyConnection` distinguishes an unrecognised id from a rejected key
from a valid id that simply did not connect).

### "Loophole Pass"

The `kilo` provider stays disabled permanently. Our own gateway, when it exists, is added as a
**custom OpenAI-compatible provider entry** with our own base URL — never Kilo's hosted gateway.
`mergeEngineConfig` unions the block list so no config path can quietly re-enable `kilo`.

## Credential storage — plaintext in the engine

**There are two credential stores, and only one of them is safe.**

| Store | Protection |
|---|---|
| Loophole's own provider settings | **encrypted** via `IEncryptionService` (Electron `safeStorage` → OS keychain on macOS/Windows) |
| The engine's `data/kilo/auth.json` | **plaintext** |

`packages/opencode/src/auth/index.ts:11` pins the path: `path.join(Global.Path.data, "auth.json")`.
`Auth.get()` reads only that file — there is no config-based or env-based auth fallback, so the
engine cannot be made to skip it without editing its source, which the brief forbids.

Options, in the order I would take them:

1. **Warn, and scope the damage.** The file lives under Loophole's own `userDataPath`, so it is
   already covered by the same OS protections as the app's private directory. Show a one-line note
   in Settings next to the provider keys. Cheap, honest, ships today.
2. **Write and shred.** Loophole decrypts from its own store and writes `auth.json` just before
   the first turn, deleting it afterwards. Still briefly plaintext on disk, and racy against a
   crash — better than nothing, worse than it looks.
3. **Keychain in the engine.** Requires a patch to Kilo. Out of bounds.

Recommend (1) now and revisit if the product needs stronger guarantees. `scripts/kilo-bok-smoke.js`
asserts the raw key text really does appear in `auth.json`, so the claim is checked rather than
assumed.

## Binary resolution — two gotchas found in the vendor launcher

`@kilocode/cli/bin/kilo` is a **Node launcher**, not the engine. The real binary is
`node_modules/@kilocode/cli-<platform>-<arch>/bin/kilo[.exe]`. The launcher does two things the
host channel now replicates:

1. **AVX2 detection** to choose the `-baseline` build on x64 CPUs without AVX2, preferring the
   faster build otherwise. Taking whichever package name sorted first picked the wrong binary on
   some machines.
2. **`KILO_TREE_SITTER_WASM_DIR`** — set to the sibling `tree-sitter/` directory when
   `tree-sitter.wasm` is present. Without it the engine cannot parse source, which breaks the
   semantic index (`semantic_search`, and its tree-sitter chunking).

The host resolves the binary directly rather than shelling out to the launcher, because a packaged
Electron app has no `node` on PATH. `LOOPHOLE_KILO_BIN` / `KILO_BIN_PATH` still override.

## Smoke test

`scripts/kilo-bok-smoke.js` answers, with a real run: does the engine start under the host's exact
environment; does a pushed key show up in `connected`; does anything phone home; and is `auth.json`
plaintext. It mirrors the host channel's spawn environment rather than importing it.

```
KILO_SMOKE_KEY=<key> KILO_SMOKE_PROVIDER=anthropic node scripts/kilo-bok-smoke.js
```

Exit `0` all passed, `1` a check failed, `2` could not run.

## UNVERIFIED — needs a live run

1. **Outbound traffic with telemetry off and no Kilo login.** `KILO_TELEMETRY_LEVEL=off` does
   disable PostHog (kilo-telemetry/src/telemetry.ts:89). The one live run could not answer this:
   the connection monitor was broken (fixed since). Re-run the smoke test to settle it.
2. **Config/data isolation on Windows and macOS.** `KILO_CONFIG_DIR` plus the XDG vars are
   verified on Linux only. On Windows/macOS the engine may still write somewhere unexpected.
3. **Whether `GET /session/{id}/diff` returns `before`/`after` for every edit.** The schema has
   them as optional. The bridge refuses to stage a change when a side is missing rather than
   risk a bad reject, but whether that ever happens in practice is untested.
4. **`POST /session/{id}/revert` as a per-file operation.** The payload takes a `messageID`, so
   revert is per message, not per file. Per-file rejection is implemented with the diff bridge
   instead, but whether the engine's own revert is ever the better path is untested.
5. **Indexing end to end.** No embedding provider was configured, so `semantic_search` has never
   been observed returning real results. Also untested: whether `KILO_TREE_SITTER_WASM_DIR` is
   enough to make tree-sitter chunking work from a packaged app.
6. **Native packaging.** ~228 MB per platform; macOS signing/notarization, Windows antivirus
   false positives, and AVX2 `-baseline` selection are all untested.
7. **Which provider keys actually connect.** The id list above came from a manual probe, not from
   a Loophole run. `classifyConnection` exists precisely because this can silently fail.
8. **Engine crash-restart under real load** — the backoff logic is written but not exercised.

## Verified by a live run

Three smoke tests were executed end to end on Windows, engine 7.8.3, provider `mistral`. The
final run, with the fixes below applied:

| Check | Result |
|---|---|
| engine binary found and runnable | PASS (`kilo.exe --version` → `7.8.3`) |
| engine started under the host's env | PASS (`127.0.0.1:4096` — note `--port 0` did **not** give 0) |
| **engine state is isolated** | PASS (6 files in our temp dir; user dirs untouched) |
| `GET /global/health` | PASS (`7.8.3`) |
| **`kilo` gateway blocked** | **PASS** (`connected=[]` before, no `kilo` afterwards) |
| **BYOK** — key reaches the provider | **PASS** (`mistral` appeared in `connected`) |
| real inference | PASS (model replied `pong`) |
| turn lifecycle | PASS (`session.idle`, 42 events) |
| **credentials are plaintext** | **CONFIRMED FAIL** — see below |
| egress | only `api.mistral.ai` and `models.dev`; **no contact with `api.kilo.ai`** |

**Bring-your-own-key is proven, not assumed.**

### Isolation: how it actually works

Measured with `scripts/kilo-isolation-probe.js`, which sets one variable at a time and reports
where the engine wrote:

| Variables set | Engine wrote into the target dir |
|---|---|
| `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` / `XDG_STATE_HOME` | **yes** |
| `KILO_CONFIG_DIR` alone | **no — inert** |
| `USERPROFILE` + `HOME` redirected | yes |
| all of the above | yes |

So `XDG_*` is the load-bearing mechanism and **`KILO_CONFIG_DIR` does nothing on its own**. The
host channel sets both, which is harmless, but only the `XDG_*` vars should be relied on.

An earlier smoke run appeared to prove isolation was impossible on Windows — the engine had read
`~/.config/kilo/*` and written a key to `~/.local/share/kilo/auth.json`. That was a bug in the
test, not the engine: the script destructured its env object and then passed `env.env`, which is
`undefined`, so `spawn` silently inherited `process.env` and no isolation variables were ever
set. The smoke test now asserts isolation explicitly so this cannot regress unnoticed.

### Credentials really are plaintext — confirmed

`auth.json` contains the raw key text verbatim. This is not a theoretical concern; the test now
fails when it detects it. The file lands inside our isolated `XDG_DATA_HOME`, so it is at least
inside Loophole's own `userDataPath`, but it is still plaintext on disk.

Note that **Loophole's own copy of the same keys is encrypted** via `IEncryptionService`
(Electron `safeStorage` → OS keychain). The engine has no equivalent and `Auth.get()` reads only
that file, so this cannot be fixed without patching the engine.

### Egress

The first egress check compared raw IPs against hostname strings, which can never match, and
reported "no watched host" while the engine was in fact talking to `api.kilo.ai`. Reverse DNS is
useless here (no PTR records). The check now forward-resolves the watched hostnames with
`dns.lookup` and matches IPs.

The final run observed exactly two destinations:

| IP | Host | Verdict |
|---|---|---|
| `162.159.142.207` | `api.mistral.ai` | the user's own provider — expected |
| `2606:4700:20::681a:96c` | `models.dev` | public model catalog, no user data |

The previous (pre-fix) run additionally contacted `64.239.123.65` = **`api.kilo.ai`**. That was
the isolation bug loading the user's real config with `kilo` enabled. It is gone now.

**Caveat:** connections are sampled once per second, so short-lived ones can be missed. Absence of
evidence is not evidence of absence; treat this as strong but not conclusive.

### Other bugs the runs caught

1. **Spinner text leaked into the chat.** The engine injects `⠋ Initializing snapshot…` as a
   `text` part while preparing the repo (`kilocode/snapshot/track.ts:538` sets
   `synthetic: true`). The projection now drops any part with `synthetic`, keyed off the flag
   rather than the wording.
2. **`disabled_providers` does not block the Kilo gateway.** `GET /provider` reported
   `connected=[kilo]` before any credential was pushed. The config schema documents
   `disabled_providers` as *"disable providers that are loaded automatically"* — it suppresses
   automatic loading only. The real control is `enabled_providers` (*"ONLY these providers will be
   enabled"*), so that is now set as an allowlist with `kilo` absent, and `mergeEngineConfig`
   strips `kilo` from it even if a caller supplies it.
3. New event types observed: `session.turn.open`, `session.turn.close`, and a large volume of
   `sync` envelopes (~20 per one-line prompt), all now filtered in `normalizeEngineEvent`.

## What was actually run

Almost nothing executable. To be unambiguous:

**Ran:** file reads and greps against the Kilo source; directory listings; a line-ending scan;
`node --check` on the scripts; **three full smoke tests with a real Mistral key**; a four-scenario
isolation probe (`scripts/kilo-isolation-probe.js`); forward-DNS lookups to attribute the observed
connections; `kilo.exe --version`; and `npm install` attempts (killed by server restarts, leaving
a partial `node_modules`).

**Did not run:** `tsc` / `npm run compile`, any unit test suite, or the IDE. The smoke test has
also not been re-run since the egress-monitor change.

**So:** the engine's runtime behaviour above is observed. Everything on the Loophole side is
still unverified — it has never been compiled, let alone run.
