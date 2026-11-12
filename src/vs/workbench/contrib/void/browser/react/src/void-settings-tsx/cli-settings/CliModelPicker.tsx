/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import type { IConfigurationService } from '../../../../../../../../platform/configuration/common/configuration.js'
import { loopholeCliModelSettingId } from './cliSettingIds.js'
import { CliModelSelect, useCliModels, useDisabledCliModels, visibleCliModels } from './CliModelSelect.js'
import { CliCustomModelDialog } from './CliCustomModelDialog.js'

const readDefaultModel = (configService: IConfigurationService) => {
	const role = configService.getValue<string>(loopholeCliModelSettingId('default')) ?? ''
	return role || (configService.getValue<string>('loophole.cli.model') ?? '')
}

/**
 * Composer model picker.
 *
 * Shares the searchable picker with the settings pages, so the list and the
 * search behaviour are identical everywhere; selecting a model starts a fresh
 * CLI session on the next turn.
 */
export const CliModelPicker = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const chatThreadService = accessor.get('IChatThreadService')
	const { models } = useCliModels()
	const { disabled } = useDisabledCliModels()
	const enabled = useMemo(() => visibleCliModels(models, disabled), [models, disabled])

	const [value, setValue] = useState(() => readDefaultModel(configService))
	const [custom, setCustom] = useState(false)

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(loopholeCliModelSettingId('default')) && !event.affectsConfiguration('loophole.cli.model')) return
			setValue(readDefaultModel(configService))
		})
		return () => disposable.dispose()
	}, [configService])

	const choose = (next: string) => {
		configService.updateValue(loopholeCliModelSettingId('default'), next)
		configService.updateValue('loophole.cli.model', next)
		setValue(next)
		chatThreadService.clearCliSessionId(chatThreadService.state.currentThreadId)
	}

	return <>
		<CliModelSelect
			value={value}
			models={enabled}
			onChange={choose}
			onCustom={() => setCustom(true)}
			className={className ?? 'text-xs text-loophole-fg-3 bg-loophole-bg-1 border border-loophole-border-1 rounded-md px-2 py-1'}
		/>
		{custom ? <CliCustomModelDialog
			value={value}
			onClose={() => setCustom(false)}
			onSave={(ref) => {
				choose(ref)
				setCustom(false)
			}}
		/> : null}
	</>
}
