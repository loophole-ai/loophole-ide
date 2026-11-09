/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Kilo-style thinking/reasoning block. Mirrors Kilo's reasoning part visual:
// a compact muted header ("Thinking" + streaming pulse) with an expandable
// markdown body. Streams open; auto-collapses once the turn moves on to tool
// calls or final text; the user can always re-expand it.
import React, { useEffect, useRef, useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { ChatMarkdownRender, ChatMessageLocation } from '../../markdown/ChatMarkdownRender.js';

// Same prose sizing as the sidebar's SmallProseWrapper (duplicated here so
// these components stay independent of SidebarChat's internals).
const SmallProseWrapper = ({ children, className }: { children: React.ReactNode; className?: string }) => {
	return <div className={`
text-loophole-fg-4
prose
prose-sm
break-words
max-w-none
leading-snug
text-[13px]
[&>:first-child]:!mt-0
[&>:last-child]:!mb-0
prose-h1:text-[14px]
prose-h1:my-4
prose-h2:text-[13px]
prose-h2:my-4
prose-h3:text-[13px]
prose-h3:my-3
prose-h4:text-[13px]
prose-h4:my-2
prose-p:my-2
prose-p:leading-snug
prose-hr:my-2
prose-ul:my-2
prose-ul:pl-4
prose-ul:list-outside
prose-ul:list-disc
prose-ul:leading-snug
prose-ol:my-2
prose-ol:pl-4
prose-ol:list-outside
prose-ol:list-decimal
prose-ol:leading-snug
marker:text-inherit
prose-blockquote:pl-2
prose-blockquote:my-2
prose-code:text-loophole-fg-3
prose-code:text-[12px]
prose-code:before:content-none
prose-code:after:content-none
prose-pre:text-[12px]
prose-pre:p-2
prose-pre:my-2
prose-table:text-[13px]
${className ?? ''}
`}>
		{children}
	</div>
};

export const ThinkingBlock = ({ text, isStreaming, hasFollowup, chatMessageLocation }: { text: string; isStreaming: boolean; hasFollowup: boolean; chatMessageLocation: ChatMessageLocation | undefined }) => {
	const isWriting = isStreaming && !hasFollowup;
	const [isOpen, setIsOpen] = useState(isWriting);
	const userToggled = useRef(false);
	useEffect(() => {
		if (!userToggled.current) setIsOpen(isWriting);
	}, [isWriting]);
	const onToggle = () => {
		userToggled.current = true;
		setIsOpen(v => !v);
	};
	return <div className='w-full border border-loophole-border-3 rounded px-2 py-1 bg-loophole-bg-3 overflow-hidden'>
		<div className='select-none flex items-center min-h-[24px] cursor-pointer' onClick={onToggle}>
			<ChevronRight className={`text-loophole-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`} />
			<Brain size={14} className={`text-loophole-fg-4 flex-shrink-0 ${isWriting ? 'animate-pulse' : ''}`} />
			<span className='text-loophole-fg-3 text-xs ml-1.5'>Thinking</span>
			{isWriting && <span className='text-loophole-fg-4 text-xs ml-1 animate-pulse'>…</span>}
		</div>
		<div className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100 py-1 max-h-[400px] overflow-y-auto' : 'max-h-0 opacity-0'}`}>
			<SmallProseWrapper className='italic'>
				<ChatMarkdownRender string={text} chatMessageLocation={chatMessageLocation} isApplyEnabled={false} isLinkDetectionEnabled={true} />
			</SmallProseWrapper>
		</div>
	</div>;
};
