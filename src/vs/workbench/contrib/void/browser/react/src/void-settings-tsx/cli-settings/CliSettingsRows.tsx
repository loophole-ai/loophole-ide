/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react'

/** Plain settings page heading, matching the existing Loophole settings look. */
export const SettingsSection = ({ title, description, children }: { title?: string, description?: React.ReactNode, children: React.ReactNode }) => {
	return <div>
		{title ? <h2 className='text-3xl mb-2'>{title}</h2> : null}
		{description ? <h4 className='text-loophole-fg-3 mb-4'>{description}</h4> : null}
		{children}
	</div>
}

/** One label/description row with its control on the right. */
export const SettingsRow = ({ label, description, children }: { label: React.ReactNode, description?: React.ReactNode, children?: React.ReactNode }) => {
	return <div className='flex flex-wrap items-center justify-between gap-3 py-3.5 px-4 border-b border-loophole-border-2 last:border-b-0'>
		<div className='min-w-0'>
			<div className='text-[15px] text-loophole-fg-1'>{label}</div>
			{description ? <div className='text-[13px] text-loophole-fg-3 mt-0.5'>{description}</div> : null}
		</div>
		<div className='flex items-center gap-2 shrink-0'>{children}</div>
	</div>
}

/** Bordered container for a group of SettingsRows. */
export const SettingsList = ({ children }: { children: React.ReactNode }) => {
	return <div className='border border-loophole-border-2 bg-loophole-bg-1 rounded-lg overflow-hidden'>{children}</div>
}

/** Quiet status line used instead of colored callouts. */
export const SettingsNote = ({ children }: { children: React.ReactNode }) => {
	return <div className='text-[13px] text-loophole-fg-3'>{children}</div>
}

/** A plain status dot + label (no bright accent colors). */
export const SettingsStatus = ({ ok, label }: { ok: boolean, label: string }) => {
	return <div className='flex items-center gap-2 text-sm text-loophole-fg-1'>
		<span className={`w-2 h-2 rounded-full ${ok ? 'bg-loophole-fg-1' : 'bg-loophole-fg-3'}`} />
		<span>{label}</span>
	</div>
}

/** Plain on/off slider, matching the chat auto-approve switch. */
export const SettingsSlider = ({ checked, onChange, label }: { checked: boolean, onChange: (checked: boolean) => void, label: string }) => {
	return <button
		type='button'
		role='switch'
		aria-checked={checked}
		aria-label={label}
		onClick={() => onChange(!checked)}
		className={`relative w-[34px] h-[18px] min-w-[34px] rounded-full border transition-colors ${checked
			? 'bg-[#0e70c0] border-[#0e70c0]'
			: 'bg-loophole-bg-2 border-loophole-border-2'}`}
	>
		<span
			className='absolute top-[1px] left-[1px] w-[14px] h-[14px] rounded-full bg-white border border-black/20 transition-transform'
			style={{ transform: checked ? 'translateX(16px)' : 'none' }}
		/>
	</button>
}
