/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'

import { useAccessor, useChatThreadsState, useChatThreadsStreamState, useSettingsState, useIsDark } from '../util/services.js'
import { TextAreaFns, VoidInputBox2 } from '../util/inputs.js'
// VoidChatArea renders the chat-mode / model / attach-file dropdowns itself
import { VoidChatArea } from '../sidebar-tsx/SidebarChat.js'
import { useLocalVoiceModel, useLocalVoiceRecorder } from '../util/localVoiceModel.js'
import { localVoiceModelService } from '../../../localVoiceModelService.js'
import { getModelCapabilities } from '../../../../common/modelCapabilities.js'
import { isFeatureNameDisabled } from '../../../../common/voidSettingsTypes.js'
import { estimateTokens } from '../../../../common/tokenizer.js'
import { StagingSelectionItem } from '../../../../common/chatThreadServiceTypes.js'
import { dayKeyOf } from '../../../../common/dailyActivityService.js'
import { VOID_CTRL_L_ACTION_ID } from '../../../actionIDs.js'

import '../styles.css'

// ---------------- activity heatmap ----------------

/**
 * Number of week-columns to draw. 53 weeks covers a full year of days
 * (53 * 7 = 371), which is what the heatmap shows.
 *
 * Cell/gap sizes are written as literal Tailwind arbitrary values below rather
 * than constants, because the class strings must be statically visible to the
 * Tailwind scanner.
 */
const WEEKS = 53

/** Row labels, Monday-first to match the grid. */
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']

/**
 * Intensity ramp: a light green means less activity, a deeper/more saturated green
 * means more. Every step keeps the same hue and is expressed as opacity over the
 * card background, so the palest step and the brightest step are both clearly
 * visible in light and dark themes. Fully opaque dark greens (emerald-900 etc.)
 * disappeared against a dark editor, which is why the ramp is opacity-based.
 * 0 is neutral rather than green, so "no activity" reads as empty.
 */
const intensityClass = (count: number): string => {
	if (count <= 0) return 'bg-loophole-bg-2'
	if (count <= 2) return 'bg-emerald-500/35'
	if (count <= 5) return 'bg-emerald-500/55'
	if (count <= 9) return 'bg-emerald-500/75'
	return 'bg-emerald-500'
}

type HeatmapCell = { day: string; count: number; col: number; row: number }

const useHeatmap = (counts: { [day: string]: number }) => {
	return useMemo(() => {
		const today = new Date()
		const cells: HeatmapCell[] = []
		const monthLabels: (string | null)[] = new Array(WEEKS).fill(null)

		// Monday = 0 ... Sunday = 6
		const endRow = (today.getDay() + 6) % 7

		for (let w = WEEKS - 1; w >= 0; w--) {
			for (let row = 0; row < 7; row++) {
				// days after today in the current week don't exist yet
				if (w === 0 && row > endRow) continue

				const d = new Date(today)
				d.setDate(today.getDate() - (w * 7) + (row - endRow))
				const day = dayKeyOf(d)
				const col = WEEKS - 1 - w

				cells.push({ day, count: counts[day] ?? 0, col, row })

				// label a column with its month when it is the first week of that month
				if (row === 0 && d.getDate() <= 7) {
					monthLabels[col] = d.toLocaleDateString(undefined, { month: 'short' })
				}
			}
		}

		return { cells, monthLabels }
	}, [counts])
}

const ActivityHeatmap = ({ counts }: { counts: { [day: string]: number } }) => {
	const { cells, monthLabels } = useHeatmap(counts)

	const activeDays = useMemo(() => cells.reduce((acc, c) => acc + (c.count > 0 ? 1 : 0), 0), [cells])

	// index the cells so the render below stays O(1) per slot
	const cellAt = useMemo(() => {
		const map = new Map<string, HeatmapCell>()
		for (const c of cells) map.set(`${c.col}:${c.row}`, c)
		return map
	}, [cells])

	return <div className='w-full rounded-lg border border-loophole-border-2 bg-loophole-bg-1 p-4 flex flex-col gap-3'>
		<div className='flex items-center justify-between'>
			<span className='text-sm font-semibold text-loophole-fg-1'>Active Conversations</span>
			<span className='text-xs text-loophole-fg-3'>Daily</span>
		</div>

		<div className='flex gap-2'>
			{/* weekday gutter */}
			<div className='flex flex-col gap-[3px] shrink-0'>
				{DAY_LABELS.map((label, i) => (
					<div key={i} className='h-[9px] w-6 text-[9px] leading-[9px] text-loophole-fg-3'>{label}</div>
				))}
			</div>

			{/* 53 columns can exceed a narrow editor group, so allow scrolling */}
			<div className='flex-1 flex flex-col gap-1 min-w-0 overflow-x-auto'>
				{/* grid */}
				<div className='flex gap-[3px] w-max'>
					{Array.from({ length: WEEKS }).map((_, col) => (
						<div key={col} className='flex flex-col gap-[3px]'>
							{Array.from({ length: 7 }).map((__, row) => {
								const cell = cellAt.get(`${col}:${row}`)
								if (!cell) return <div key={row} className='h-[9px] w-[9px] opacity-0' />
								return <div
									key={row}
									title={`${cell.count} message${cell.count === 1 ? '' : 's'} on ${cell.day}`}
									className={`h-[9px] w-[9px] rounded-[2px] ${intensityClass(cell.count)}`}
								/>
							})}
						</div>
					))}
				</div>

				{/* month labels */}
				<div className='flex gap-[3px] w-max'>
					{monthLabels.map((label, col) => (
						<div key={col} className='w-[9px] shrink-0 text-[9px] leading-[12px] text-loophole-fg-3'>{label ?? ''}</div>
					))}
				</div>
			</div>
		</div>

		<div className='flex items-center justify-between text-[10px] text-loophole-fg-3'>
			<span>
				{activeDays > 0
					? `${activeDays} active day${activeDays === 1 ? '' : 's'} in the last year`
					: `No activity yet in the last year`}
			</span>
			<span className='flex items-center gap-1'>
				Less
				{[0, 2, 5, 9, 12].map((n, i) => <div key={i} className={`h-[9px] w-[9px] rounded-[2px] ${intensityClass(n)}`} />)}
				More
			</span>
		</div>
	</div>
}

// ---------------- the screen ----------------

const DEFAULT_BUTTON_SIZE = 22

export const EmptyEditorHome = () => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const dailyActivityService = accessor.get('IDailyActivityService')

	const isDark = useIsDark()

	const settingsState = useSettingsState()
	const chatThreadsState = useChatThreadsState()

	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)

	// ---------- heatmap data ----------
	const [counts, setCounts] = useState<{ [day: string]: number }>(dailyActivityService.state)
	useEffect(() => {
		setCounts(dailyActivityService.state)
		return dailyActivityService.onDidChange(setCounts)
	}, [dailyActivityService])

	// ---------- voice ----------
	const voiceState = useLocalVoiceModel()
	const selectedVoiceModelId = settingsState.globalSettings.localVoiceModelId
	const selectedVoiceModelStatus = selectedVoiceModelId === null ? undefined : voiceState.statusByModel[selectedVoiceModelId]
	const isVoiceModelReady = selectedVoiceModelStatus === 'ready'

	useEffect(() => {
		if (!selectedVoiceModelId || selectedVoiceModelStatus !== 'installed') return
		void localVoiceModelService.ensureModel(selectedVoiceModelId).catch(() => undefined)
	}, [selectedVoiceModelId, selectedVoiceModelStatus])

	const onVoiceTranscript = useCallback((text: string) => {
		textAreaFnsRef.current?.insertTextAtCursor(text)
	}, [])
	const voiceRecorder = useLocalVoiceRecorder(isVoiceModelReady ? selectedVoiceModelId : null, onVoiceTranscript)

	// ---------- thread / stream state ----------
	const currentThread = chatThreadsService.getCurrentThread()
	const currThreadStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId)
	const isRunning = currThreadStreamState?.isRunning

	const selections: StagingSelectionItem[] = currentThread?.state.stagingSelections ?? []
	const setSelections = (s: StagingSelectionItem[]) => { chatThreadsService.setCurrentThreadState({ stagingSelections: s }) }

	// ---------- local input state ----------
	const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(true)
	const [tokenEstimate, setTokenEstimate] = useState(0)

	const isDisabled = instructionsAreEmpty || !!isFeatureNameDisabled('Chat', settingsState)

	const chatModelSelection = settingsState.modelSelectionOfFeature['Chat']
	const chatContextWindow = chatModelSelection
		? getModelCapabilities(chatModelSelection.providerName, chatModelSelection.modelName, settingsState.overridesOfModel).contextWindow
		: undefined

	// ---------- submit / abort ----------
	const onSubmit = useCallback(async (_forceSubmit?: string) => {
		if (isDisabled && !_forceSubmit) return
		if (voiceRecorder.isRecording || voiceRecorder.isTranscribing) return
		if (isRunning) return

		const threadId = chatThreadsService.state.currentThreadId
		const userMessage = _forceSubmit || textAreaRef.current?.value || ''

		try {
			await chatThreadsService.addUserMessageAndStreamResponse({ userMessage, threadId })
		} catch (e) {
			console.error('Error while sending message from the empty editor screen:', e)
		}

		setSelections([])
		textAreaFnsRef.current?.setValue('')
		textAreaRef.current?.focus()
	}, [chatThreadsService, isDisabled, isRunning, textAreaRef, textAreaFnsRef, setSelections, voiceRecorder.isRecording, voiceRecorder.isTranscribing])

	const onAbort = useCallback(async () => {
		await chatThreadsService.abortRunning(chatThreadsService.state.currentThreadId)
	}, [chatThreadsService])

	const keybindingString = accessor.get('IKeybindingService').lookupKeybinding(VOID_CTRL_L_ACTION_ID)?.getLabel()

	const onChangeText = useCallback((newStr: string) => {
		setInstructionsAreEmpty(!newStr)
		setTokenEstimate(estimateTokens(newStr))
	}, [])

	const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
			onSubmit()
		} else if (e.key === 'Escape' && isRunning) {
			onAbort()
		}
	}, [onSubmit, onAbort, isRunning])

	// ---------- voice button ----------
	const voiceButton = isVoiceModelReady && !isRunning ? <button
		type='button'
		className={`rounded-full flex items-center justify-center ${voiceRecorder.isRecording ? 'bg-red-500 text-white' : 'bg-loophole-bg-2 text-loophole-fg-2 hover:bg-loophole-bg-3'} ${voiceRecorder.isTranscribing ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}
		aria-label={voiceRecorder.isRecording ? 'Stop dictation' : 'Start dictation'}
		aria-pressed={voiceRecorder.isRecording}
		disabled={voiceRecorder.isTranscribing}
		title={voiceRecorder.error || (voiceRecorder.isRecording ? 'Stop dictation' : 'Dictate with a local model')}
		onMouseDown={event => event.preventDefault()}
		onClick={() => {
			if (voiceRecorder.isRecording) voiceRecorder.stop()
			else void voiceRecorder.start()
		}}
	>
		{voiceRecorder.isTranscribing ? <Loader2 size={DEFAULT_BUTTON_SIZE} className="animate-spin" />
			: voiceRecorder.isRecording ? <Square size={DEFAULT_BUTTON_SIZE} />
				: <Mic size={DEFAULT_BUTTON_SIZE} />}
	</button> : undefined

	// bg-3 is --vscode-editor-background, so the screen blends into the empty editor
	return <div className={`@@loophole-scope ${isDark ? 'dark' : ''} h-full w-full overflow-y-auto bg-loophole-bg-3 text-loophole-fg-1`}>
		{/* max-w-5xl so the 53-column heatmap fits without scrolling on a normal group */}
		<div className='min-h-full w-full max-w-5xl mx-auto flex flex-col justify-center gap-8 px-6 py-10'>

			{/* logo - reuses the workbench CSS rule so the asset resolves from editorgroupview.css */}
			<div className='flex justify-center'>
				<div className='@@loophole-loophole-icon' style={{ width: 96, maxWidth: 96, opacity: 0.9 }} />
			</div>

			{/* heading */}
			<div className='flex flex-col items-center gap-1 text-center'>
				<h1 className='text-2xl font-semibold text-loophole-fg-1 m-0'>Beyond Code Completion</h1>
				<p className='text-base text-loophole-fg-3 m-0'>An Agentic AI IDE</p>
			</div>

			{/* activity heatmap */}
			<ActivityHeatmap counts={counts} />

			{/* input - same components the chat sidebar uses */}
			<div className='w-full'>
				<VoidChatArea
					featureName='Chat'
					micButton={voiceButton}
					onSubmit={() => onSubmit()}
					onAbort={onAbort}
					isStreaming={!!isRunning}
					isDisabled={isDisabled || voiceRecorder.isRecording || voiceRecorder.isTranscribing}
					showSelections={true}
					selections={selections}
					setSelections={setSelections}
					onClickAnywhere={() => { textAreaRef.current?.focus() }}
					tokenCount={tokenEstimate}
					contextWindow={chatContextWindow}
				>
					<VoidInputBox2
						enableAtToMention
						className='min-h-[81px] px-0.5 py-0.5'
						placeholder={`@ to mention, ${keybindingString ? `${keybindingString} to add a selection. ` : ''}Enter instructions...`}
						onChangeText={onChangeText}
						onKeyDown={onKeyDown}
						onFocus={() => { chatThreadsService.setCurrentlyFocusedMessageIdx(undefined) }}
						ref={textAreaRef}
						fnsRef={textAreaFnsRef}
						multiline={true}
					/>
				</VoidChatArea>
			</div>
		</div>
	</div>
}
