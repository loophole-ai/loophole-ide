/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection, SettingsSlider } from './CliSettingsRows.js'

type PresetId =
	| 'edit'
	| 'write'
	| 'delete'
	| 'bash'
	| 'glob'
	| 'grep'
	| 'read'
	| 'webfetch'
	| 'websearch'
	| 'image-generate'
	| 'question'
	| 'skill'
	| 'subagent'
	| 'automation'
	| 'todo'
	| 'mcp'
	| 'search';

/**
 * Permission actions the CLI can assert. Every action is ask-before-use by default;
 * the switches on this page turn any of them into always-allow (agent & chat).
 * The CLI itself still prompts when no saved allow rule matches — that's the
 * opencode permission flow, not this setting.
 */
const PRESETS: Array<{ id: PresetId; label: string; description?: string; request?: { action: string; resources: string[] } }> = [
	{ id: 'read', label: 'Read files', description: 'Reading files inside the project' },
	{ id: 'glob', label: 'Find files by glob', description: 'Searching by filename patterns' },
	{ id: 'grep', label: 'Search file contents', description: 'Searching inside files' },
	{ id: 'edit', label: 'Edit files', description: 'Applying edits to files' },
	{ id: 'write', label: 'Write files', description: 'Writing new files' },
	{ id: 'delete', label: 'Delete files', description: 'Deleting files' },
	{ id: 'bash', label: 'Run commands', description: 'Running terminal commands' },
	{ id: 'webfetch', label: 'Fetch web pages', description: 'Fetching the contents of URLs' },
	{ id: 'websearch', label: 'Search the web', description: 'Searching the web for docs' },
	{ id: 'image-generate', label: 'Generate images', description: 'Creating images from text' },
	{ id: 'subagent', label: 'Use subagents', description: 'Spawning subagents for the task' },
	{ id: 'skill', label: 'Load skills', description: 'Reusing packaged skills' },
	{ id: 'question', label: 'Ask questions', description: 'Asking you questionnaire questions' },
	{ id: 'todo', label: 'Track todos', description: 'Updating the todo list' },
	{ id: 'search', label: 'Search tasks', description: 'Searching tasks and notes' },
	{ id: 'automation', label: 'Automation', description: 'Automation records' },
	{ id: 'mcp', label: 'MCP servers', description: 'Calling tools from MCP servers' },
]

const KEY_ALL = 'loophole.permissions.alwaysAllowed';

export const CliPermissionsTab = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const [always, setAlways] = useState<PresetId[]>(() =>
		(configService.getValue<string[]>(KEY_ALL) ?? []) as PresetId[],
	)

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(KEY_ALL)) return;
			setAlways((configService.getValue<string[]>(KEY_ALL) ?? []) as PresetId[]);
		})
		return () => disposable.dispose()
	}, [configService])

	const toggle = useCallback((id: PresetId, next: boolean) => {
		const value = next ? [...new Set([...always, id])] : always.filter((item) => item !== id);
		configService.updateValue(KEY_ALL, value);
		setAlways(value);
	}, [always, configService])

	const anyOn = always.length > 0

	return <SettingsSection
		title='Permissions'
		description='Each switch below lets Loophole use the matching permission without asking for approval. Leave a switch off to be asked every time (default).'
	>
		<SettingsList>
			{PRESETS.map((preset) => <SettingsRow key={preset.id} label={preset.label} description={preset.description}>
				<SettingsSlider
					checked={always.includes(preset.id)}
					onChange={(next) => toggle(preset.id, next)}
					label={`Always allow ${preset.label}`}
				/>
			</SettingsRow>)}
		</SettingsList>
		<div className='mt-3'>
			<SettingsNote>
				Turning one of these on passes `always` as the decision when Loophole asks. The agent still cannot
				reach your machine without one of these permissions – you can flip any of them back off at any time.
				{anyOn ? ` ${always.length} permission${always.length === 1 ? ' is' : 's are'} currently always-allowed.` : ''}
			</SettingsNote>
		</div>
	</SettingsSection>
}
