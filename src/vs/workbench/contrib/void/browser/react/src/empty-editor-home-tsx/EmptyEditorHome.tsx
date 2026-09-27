/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useState } from 'react'

import { useAccessor, useIsDark } from '../util/services.js'
import { VOID_CTRL_K_ACTION_ID, VOID_CTRL_L_ACTION_ID } from '../../../actionIDs.js'

import '../styles.css'

// ---------------- shortcuts ----------------

/**
 * The commands worth surfacing on an empty editor. Anything whose command has
 * no keybinding (the user may have unbound it) is dropped, so the list only
 * ever shows keys that actually do something.
 */
const SHORTCUTS: { id: string; label: string }[] = [
	{ id: VOID_CTRL_L_ACTION_ID, label: 'Chat' },
	{ id: VOID_CTRL_K_ACTION_ID, label: 'Quick Edit' },
	{ id: 'inlineChat.start', label: 'Inline Chat' },
	{ id: 'workbench.action.quickOpen', label: 'Go to File' },
	{ id: 'workbench.action.showCommands', label: 'All Commands' },
	{ id: 'workbench.action.openGlobalKeybindings', label: 'Keyboard Shortcuts' },
	{ id: 'workbench.action.terminal.toggleTerminal', label: 'Toggle Terminal' },
]

const Shortcuts = () => {
	const accessor = useAccessor()
	const keybindingService = accessor.get('IKeybindingService')

	// re-read the keybindings whenever the user changes them
	const [, setKeybindingVersion] = useState(0)
	useEffect(() => {
		const listener = keybindingService.onDidUpdateKeybindings(() => setKeybindingVersion(v => v + 1))
		return () => { listener.dispose() }
	}, [keybindingService])

	const shortcuts = useMemo(
		() => SHORTCUTS
			.map(shortcut => ({ ...shortcut, keys: keybindingService.lookupKeybinding(shortcut.id)?.getLabel() ?? null }))
			.filter(shortcut => shortcut.keys !== null),
		// keybindingService.getKeybindings().length changes whenever the keybindings do,
		// so the memo recomputes on every user keybinding change
		[keybindingService, keybindingService.getKeybindings().length]
	)

	return <div className='w-full rounded-lg border border-loophole-border-2 bg-loophole-bg-1 px-4 py-2'>
		{shortcuts.map(shortcut => <div key={shortcut.id} className='flex items-center justify-between py-1'>
			<span className='text-loophole-fg-2'>{shortcut.label}</span>
			<span className='text-loophole-fg-3'>{shortcut.keys}</span>
		</div>)}
	</div>
}

// ---------------- the screen ----------------

export const EmptyEditorHome = () => {
	const isDark = useIsDark()

	// bg-3 is --vscode-editor-background, so the screen blends into the empty editor
	return <div className={`@@loophole-scope ${isDark ? 'dark' : ''} h-full w-full overflow-y-auto bg-loophole-bg-3 text-loophole-fg-1`}>
		{/*
		 * `my-auto` centres the block vertically without `justify-content: center`,
		 * which would push content above the scroll container and make the top
		 * unreachable when the group is short.
		 */}
		<div className='min-h-full w-full flex flex-col items-center'>
			<div className='my-auto w-full max-w-xl flex flex-col gap-10 px-8 py-12'>

				{/* logo - reuses the workbench CSS rule so the asset resolves from editorgroupview.css */}
				<div className='flex justify-center'>
					<div className='@@loophole-loophole-icon' style={{ width: 96, maxWidth: 96, opacity: 0.9 }} />
				</div>

				{/* heading */}
				<div className='flex flex-col items-center gap-1.5 text-center'>
					<h1 className='text-2xl font-semibold text-loophole-fg-1 m-0'>Beyond Code Completion</h1>
					<p className='text-base text-loophole-fg-3 m-0'>An Agentic AI IDE</p>
				</div>

				{/* shortcuts */}
				<Shortcuts />
			</div>
		</div>
	</div>
}
