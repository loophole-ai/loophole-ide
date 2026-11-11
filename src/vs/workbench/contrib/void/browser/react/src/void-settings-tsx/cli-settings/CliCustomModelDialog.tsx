/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react'
import { VoidButtonBgDarken, VoidSimpleInputBox } from '../../util/inputs.js'

/** Custom model entry: a model id plus the provider that hosts it, stored as provider/modelID. */
export const CliCustomModelDialog = ({ value, onClose, onSave }: {
	value: string
	onClose: () => void
	onSave: (ref: string) => void
}) => {
	const slash = value.indexOf('/')
	const [provider, setProvider] = useState(slash > 0 ? value.slice(0, slash) : '')
	const [modelID, setModelID] = useState(slash > 0 ? value.slice(slash + 1) : value)

	const save = () => {
		const id = modelID.trim()
		const owner = provider.trim()
		if (!id || !owner) return
		onSave(`${owner}/${id}`)
	}

	return <div
		className='fixed inset-0 bg-black/40 flex items-center justify-center z-[9999999]'
		onClick={onClose}
	>
		<div
			className='bg-loophole-bg-1 border border-loophole-border-1 rounded-sm p-4 w-full max-w-sm'
			onClick={(e) => e.stopPropagation()}
		>
			<h3 className='text-base text-loophole-fg-1'>Custom model</h3>
			<div className='text-xs text-loophole-fg-3 mt-1'>Enter the model id exactly as the provider exposes it.</div>

			<div className='flex flex-col gap-2 mt-4'>
				<div className='text-xs text-loophole-fg-3'>Model id</div>
				<VoidSimpleInputBox value={modelID} onChangeValue={setModelID} placeholder='mercury-edit-2' compact={true} />
				<div className='text-xs text-loophole-fg-3 mt-1'>Provider</div>
				<VoidSimpleInputBox value={provider} onChangeValue={setProvider} placeholder='inception' compact={true} />
				<div className='text-xs text-loophole-fg-3 mt-1 truncate'>
					Saved as {provider.trim() || 'provider'}/{modelID.trim() || 'modelID'}
				</div>
				<div className='flex items-center gap-2 mt-2'>
					<VoidButtonBgDarken className='px-3 py-1' onClick={save} disabled={!provider.trim() || !modelID.trim()}>Save</VoidButtonBgDarken>
					<VoidButtonBgDarken className='px-3 py-1' onClick={onClose}>Cancel</VoidButtonBgDarken>
				</div>
			</div>
		</div>
	</div>
}
