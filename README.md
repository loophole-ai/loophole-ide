<p align="center">
  <img src="logo/logo.png" width="80" alt="Loophole" />
</p>

<h1 align="center">Loophole IDE</h1>

<p align="center">
The open-source AI code editor that thinks while you code.
</p>

<div align="center">

<img src="https://img.shields.io/github/license/loophole-ai/loophole-ide?style=for-the-badge" alt="License" />
<img src="https://img.shields.io/github/stars/loophole-ai/loophole-ide?style=for-the-badge" alt="Stars" />
<img src="https://img.shields.io/github/issues/loophole-ai/loophole-ide?style=for-the-badge" alt="Issues" />

</div>

<div align="center">

<table>
<tbody>
<td align="center"><a href="https://www.loopholeeditor.in"><strong>Loophole</strong></a></td>
<td align="center"><a href="https://github.com/loophole-ai/loophole-ide"><strong>GitHub</strong></a></td>
<td align="center"><a href="./LOOPHOLE_CODEBASE_GUIDE.md"><strong>Documentation</strong></a></td>
<td align="center"><a href="./HOW_TO_CONTRIBUTE.md"><strong>Contributing</strong></a></td>
<td align="center"><a href="https://github.com/loophole-ai/loophole-ide/issues"><strong>Issues</strong></a></td>
<td align="center"><a href="https://github.com/loophole-ai/loophole-ide/discussions"><strong>Discussions</strong></a></td>
</tbody>
</table>

</div>

<br>

<p align="center">
  <img src="logo/20260327_123134.png" width="100%" alt="Loophole Editor" />
</p>

Loophole is a fully open-source AI-native code editor forked from the Void Editor (itself a fork of VS Code). It integrates AI capabilities at the deepest level of the editor — not as a plugin bolted on top, but as a core part of the editing experience.

AI requests are sent **directly from your machine to your chosen provider**. Your code never passes through a Loophole server. You bring your own API key or run local models, and Loophole handles the rest.

It ships with a full agentic engine, inline autocomplete, a four-mode AI chat sidebar, Quick Edit, AI-generated Git commit messages, voice input, token usage and cost tracking, MCP server support, and a per-feature model assignment system — all inside a familiar VS Code-based desktop editor.

## Why Loophole

- **Privacy by architecture, not policy.** Every AI request goes directly from your machine to the provider over their public API. There is no Loophole backend, no prompt logging, and no intermediate relay. The only data that leaves your machine is what you explicitly send to a provider.
- **Four chat modes for four kinds of work.** Normal mode answers questions conversationally. Gather mode lets the AI read and search your codebase without touching any files. Plan mode lets the AI draft `.md` plans for you to review before anything runs. Agent mode gives the AI full tool access to read, write, run commands, manage todos, and spawn sub-agents autonomously.
- **A real agentic tool surface.** The agent can read files with pagination, make surgical SEARCH/REPLACE edits, rewrite entire files, create and delete files and folders, rename and move paths, insert code at exact line numbers, run terminal commands, open persistent terminal sessions for long-running processes, and perform ripgrep-style codebase searches with surrounding context. After every edit it reads lint errors and can fix them before considering the task done.
- **Parallel sub-agents.** The agent can spawn `general` (full tools) or `researcher` (read-only) sub-agents to handle independent subtasks concurrently. Sub-agents can run in the background while the main agent continues, and prior sub-agent sessions can be resumed by passing a `task_id`.
- **Autocomplete built for speed.** The inline completion engine uses a Fill-In-the-Middle approach, sending the code before and after the cursor so the model predicts exactly what belongs in between. It debounces at 350ms, caches up to 20 recent completions, keeps at most 2 concurrent requests, and strips English preamble and sentinel tokens before showing a suggestion. Autocomplete can use its own dedicated model, separate from chat. Providers with FIM-optimized models — such as Inception's `mercury-edit-2` diffusion model — are flagged and recommended.
- **Per-feature model assignment.** Chat, Quick Edit (Ctrl+K), Autocomplete, Apply, and Git commit message generation each have their own model slot. Use a powerful reasoning model for chat and a fast cheap model for autocomplete and apply without changing any other setting.
- **20+ providers, including fully local ones.** Anthropic, OpenAI, Google Gemini, DeepSeek, xAI, Mistral, Groq, Cohere, Perplexity, OpenRouter, Together AI, Fireworks AI, Inception Labs, LiteLLM, Google Vertex AI, Microsoft Azure, AWS Bedrock, and any OpenAI-compatible endpoint. Ollama, vLLM, and LM Studio are auto-detected — their model lists refresh automatically.
- **Reasoning model support.** When a model supports extended thinking, Loophole configures it correctly: budget sliders for Anthropic-style reasoning, effort sliders for OpenAI-style, and a collapsible "Thinking…" section in the chat UI. Reasoning output is streamed live alongside the response.
- **MCP server support.** Connect external Model Context Protocol servers to extend the agent with custom tools. MCP tools appear alongside built-in tools in Agent mode and go through the same approval flow.
- **Token usage and cost tracking.** Every response records input tokens, output tokens, and an estimated USD cost based on per-provider pricing. A Token Usage dialog shows cumulative daily totals across sessions.
- **AI commit messages.** The Git SCM panel has an AI button that sends your staged diff to the configured SCM model and streams a commit message directly into the Git input box. This is wired into the VS Code SCM service itself, not an extension.
- **Voice input.** You can dictate messages to the chat using your microphone. Loophole captures PCM audio, transcribes it via the provider, and populates the chat input with the result.
- **Approval controls.** File edits, terminal commands, and MCP tool calls each have their own approval category. You can require manual confirmation per category or enable auto-approve globally in settings.

## Supported providers

| Provider | Notes |
|----------|-------|
| Anthropic | Claude models, streaming, reasoning support |
| OpenAI | GPT and o-series models |
| Google Gemini | Gemini Flash and Pro, native Gemini message format |
| DeepSeek | DeepSeek V4 Pro and Flash |
| xAI | Grok models including reasoning variants |
| Mistral | Mistral Large, Magistral, Codestral, Devstral |
| Groq | Ultra-fast inference |
| Cohere | Command models including reasoning |
| Perplexity | Sonar models with web search |
| OpenRouter | 200+ models via a single API key |
| Together AI | Open-source model hosting |
| Fireworks AI | Fast open-source inference |
| Inception Labs | Mercury diffusion models, FIM-optimized for autocomplete |
| LiteLLM | OpenAI-compatible proxy layer |
| Google Vertex AI | Enterprise Google AI via OpenAI-compatible endpoint |
| Microsoft Azure | Azure AI Foundry and Azure OpenAI |
| AWS Bedrock | Amazon-managed AI models |
| Ollama | Local model runner, auto-detected |
| vLLM | Local high-performance inference, auto-detected |
| LM Studio | Local GUI model runner, auto-detected |
| OpenAI Compatible | Any custom endpoint with an OpenAI-compatible API |

## Build from source

Requirements: Node.js 22 or higher, Python, and C++ build tools.

```bash
git clone https://github.com/loophole-ai/loophole-ide.git
cd loophole-ide

npm install
npm run buildreact

# In one terminal
npm run watch

# In another terminal
npm run electron
```

## Project structure

All AI-specific code lives under `src/vs/workbench/contrib/void/`. The `browser/` layer contains the autocomplete engine, context gathering service, SCM integration, sidebar and Quick Edit panes, and all React UI components. The `common/` layer contains model capability flags, provider and settings types, all built-in tool definitions, LLM message format types, the MCP protocol types, token usage tracking, and per-provider system prompt files under `prompt/model-prompts/`. The `electron-main/` layer handles the actual HTTP calls to providers over IPC, keeping network access out of the renderer process.

The `extensions/` directory contains all standard VS Code built-in extensions plus `theme-loophole`, Loophole's custom dark theme. The `cli/` directory contains Rust-based CLI tooling. Build scripts live in `build/` and static resources in `resources/`.

## How AI requests flow

A user action — sending a chat message, pressing Ctrl+K, or typing in the editor — triggers the relevant service. That service calls `contextGatheringService` to assemble context from open files, selections, and workspace structure. The context is converted into the provider's native message format by `convertToLLMMessageService` and sent over an Electron IPC channel to the main process. The main process makes the HTTP call directly to the provider's API, streams the response back to the renderer via IPC, and the UI updates in real time. Tool calls in the response are parsed and dispatched to the appropriate handler — file edits appear as diffs with accept/reject controls, terminal commands run in the integrated terminal. The agent loop continues until the model calls `attempt_completion` or the user interrupts it.

## Contributing

We welcome contributions from the community. Please read the [Contributing Guide](./HOW_TO_CONTRIBUTE.md) before submitting a pull request. For a deep technical overview of the codebase, see the [Loophole Codebase Guide](./LOOPHOLE_CODEBASE_GUIDE.md).

## License

Loophole is licensed under the [GNU Affero General Public License v3.0](./LICENSE.txt) (AGPL-3.0). It incorporates code from [Void Editor](https://github.com/voideditor/void) (Apache 2.0) and [VS Code](https://github.com/microsoft/vscode) (MIT).
