# Changelog

This changelog starts at **v2.2.11**. Earlier Loophole IDE releases were not consistently recorded in this file.

## v2.2.12 - 2026-11-28

### Expert Canvas
- Added **Expert Canvas**, a team of AI experts that works on your goal together. Open it from the new **Experts** view in the activity bar, or run **Loophole: Open Expert Canvas** from the command palette.
- Eight experts, each with a role: Sara (Team Lead), Leo (Researcher), Karl (Engineer), Jake (QA Engineer), Ray (Code Reviewer), Nora (Debug Engineer), Elena (UI/UX Operator) and Max (Docs Writer).
- Sara plans the goal and picks which experts to bring in and in what order. Each expert hands its result to the next one.
- Experts run on the Loophole CLI and use the same models and providers as chat.
- Experts have role-based limits. Ray, Leo and Elena are read-only, Jake can run commands, Karl and Max can edit files, and Nora can do both. Anything outside a role is refused.
- Edits and commands wait for your approval in the canvas. Turn on **auto-approve** to skip the prompts.
- Talk to one expert directly with **@mention**.
- Each expert can use its own model. An expert with no choice uses the chat model ("Same as Chat").
- New settings: `loophole.experts.models`, `loophole.experts.disabled` and `loophole.experts.autoApprove`.

### Onboarding
- The **Add a Provider** page now uses the Loophole CLI instead of the old Void provider setup.
- Connect with an API key from the **Popular** or **All** tab, or add an OpenAI-compatible endpoint in **Custom**.
- Shows progress while the CLI starts and offers **Try again** if it fails.
- Choose which models to switch on right in onboarding. The first one you pick becomes your default chat model.
- Added a **Skip for now** button, so you can set up providers later in Settings.
- Removed the local voice model download from onboarding.
---

## v2.2.11 - 2026-11-26

### CLI & Connection
- Start the CLI automatically when the editor opens.
- Added a health check for stale CLI connections and improved reconnect recovery.
- Improved CLI status in Settings/About, including clearer download/not-installed states.
- Wait for plugins before reporting connected and auto-restart the CLI on crash.
- Refresh the sidebar model dropdown when CLI model settings change.

### Models & Providers
- Added opt-in model management: models are grouped by provider and can be enabled from **Manage models**.
- Chat and commit-message model pickers now show only enabled models.
- New provider models are left unchecked by default so users can choose the models they want.
- Replaced disabled-model tracking with enabled-model tracking for clearer model selection behavior.

### Build & Stability
- Fixed React bundle external import path rewriting that caused `minify-vscode` to fail resolving `voidSettingsPane.js`.
- Limited build import rewriting to project source files and bundled npm dependencies correctly.
- Fixed a missing `count` field in the dummy diff change type.

### SCM & UI
- Generated commit messages now include a short description body and the Loophole co-author trailer.
- Simplified the read tool block in chat.
