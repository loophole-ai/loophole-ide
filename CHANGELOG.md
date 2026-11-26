# Changelog

This changelog starts at **v2.2.11**. Earlier Loophole IDE releases were not consistently recorded in this file.

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
