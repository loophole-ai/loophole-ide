/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import type { IConfigurationService } from '../../../../../../../../platform/configuration/common/configuration.js'
import { loopholeCliModelSettingId } from './cliSettingIds.js'
import { CliModelSelect, useCliModels, useEnabledCliModels, visibleCliModels } from './CliModelSelect.js'
import { CliCustomModelDialog } from './CliCustomModelDialog.js'
import { VOID_OPEN_SETTINGS_ACTION_ID } from '../../../../voidSettingsPane.js'

const readDefaultModel = (configService: IConfigurationService) => {
	const role = configService.getValue<string>(loopholeCliModelSettingId('default')) ?? ''
	return role || (configService.getValue<string>('loophole.cli.model') ?? '')
}

/** Composer model picker. Selecting a model starts a fresh CLI session on the next turn. */
export const CliModelPicker = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const chatThreadService = accessor.get('IChatThreadService')
	const commandService = accessor.get('ICommandService')
	const { models } = useCliModels()
	const { enabled: enabledRefs } = useEnabledCliModels()

	const [value, setValue] = useState(() => readDefaultModel(configService))
	// Only checked models reach the dropdown (the current selection is always kept).
	const enabled = useMemo(() => visibleCliModels(models, enabledRefs, value ? [value] : []), [models, enabledRefs, value])
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
			onManage={() => { void commandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID) }}
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
