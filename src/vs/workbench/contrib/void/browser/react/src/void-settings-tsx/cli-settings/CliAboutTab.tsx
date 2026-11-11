/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { SettingsList, SettingsRow, SettingsSection } from './CliSettingsRows.js'

/** App and CLI identity, version, license, and project links. */
export const CliAboutTab = () => {
	const accessor = useAccessor()
	const productService = accessor.get('IProductService')
	const cliService = accessor.get('ILoopholeCliService')

	const [version, setVersion] = useState('')

	useEffect(() => {
		let cancelled = false
		void cliService.version().then(next => { if (!cancelled) setVersion(next) }).catch(() => { if (!cancelled) setVersion('unknown') })
		return () => { cancelled = true }
	}, [cliService])

	return <SettingsSection title='About'>
		<SettingsList>
			<SettingsRow label='Application' description={productService.nameLong}>
				<span className='text-xs text-loophole-fg-2'>{productService.version}</span>
			</SettingsRow>
			<SettingsRow label='Loophole CLI'>
				<span className='text-xs text-loophole-fg-2'>{version || 'Checking...'}</span>
			</SettingsRow>
			<SettingsRow label='License' description='Loophole IDE is based on VS Code and is distributed under the Apache License 2.0.'>
				<span className='text-xs text-loophole-fg-3'>Apache-2.0</span>
			</SettingsRow>
			<SettingsRow label='Project' description='Source, issues, and documentation.'>
				<a className='text-xs text-loophole-fg-2 underline' href='https://github.com/loophole-ai/loophole-ide' target='_blank' rel='noreferrer'>github.com/loophole-ai/loophole-ide</a>
			</SettingsRow>
		</SettingsList>
	</SettingsSection>
}
