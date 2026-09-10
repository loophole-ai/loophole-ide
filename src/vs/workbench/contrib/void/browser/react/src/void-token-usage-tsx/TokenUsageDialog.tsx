/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Garv Agnihotri, Inc. All rights reserved.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAccessor, useIsDark } from '../util/services.js';
import { DailyTokenEntry, formatTokenCount, formatDollarCount } from '../../../../common/tokenUsageService.js';
import { X } from 'lucide-react';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';


const PAD = { top: 28, right: 20, bottom: 44, left: 68 };
const CHART_HEIGHT = 300;
// Fixed palette — consistent color per model name
const PALETTE = [
    '#3b82f6', '#f97316', '#10b981', '#a855f7', '#eab308',
    '#ec4899', '#14b8a6', '#f43f5e', '#8b5cf6', '#06b6d4',
    '#84cc16', '#fb923c', '#e879f9', '#34d399', '#60a5fa',
];

function modelColor(model: string, allModels: string[]): string {
    const idx = allModels.indexOf(model);
    return PALETTE[idx % PALETTE.length];
}

function toDateLabel(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function yAxisTicks(maxVal: number): number[] {
    const steps = [
        100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
        10_000_000, 25_000_000, 50_000_000, 100_000_000,
    ];
    for (const step of steps) {
        const ticks: number[] = [];
        for (let v = 0; v <= maxVal * 1.2; v += step) ticks.push(v);
        if (ticks.length >= 4 && ticks.length <= 7) return ticks;
    }
    const step = Math.ceil(maxVal / 5 / 100_000) * 100_000 || 100_000;
    return Array.from({ length: 6 }, (_, i) => i * step);
}

interface TooltipState {
    barX: number;
    barY: number;
    entry: DailyTokenEntry;
}

interface ChartProps {
    data: DailyTokenEntry[];
    allModels: string[];
}

const UsageChart = ({ data, allModels }: ChartProps) => {
    const [svgWidth, setSvgWidth] = useState(720);
    const svgRef = useRef<SVGSVGElement>(null);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);

    useEffect(() => {
        if (!svgRef.current) return;
        const ro = new ResizeObserver(es => setSvgWidth(es[0].contentRect.width));
        ro.observe(svgRef.current);
        return () => ro.disconnect();
    }, []);

    const plotW = svgWidth - PAD.left - PAD.right;
    const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;

    const maxTok = data.length ? Math.max(...data.map(d => d.tokens)) : 1_000_000;
    const ticks = yAxisTicks(maxTok);
    const yMax = ticks[ticks.length - 1];

    const barCount = data.length;
    const barGap = Math.max(1, plotW / barCount * 0.15);
    const barW = barCount > 0 ? (plotW - barGap * (barCount - 1)) / barCount : 20;

    const xOf = (i: number) => PAD.left + i * (barW + barGap);
    const yOf = (tok: number) => PAD.top + plotH - (tok / yMax) * plotH;
    const hOf = (tok: number) => (tok / yMax) * plotH;

    const xStep = Math.max(1, Math.ceil(data.length / 9));
    const mutedColor = 'var(--loophole-fg-3)';
    const gridColor = 'var(--loophole-border-4)';

    return (
        <div style={{ position: 'relative' }}>
            <svg
                ref={svgRef}
                width='100%'
                height={CHART_HEIGHT}
                onMouseLeave={() => setTooltip(null)}
                style={{ display: 'block', overflow: 'visible' }}
            >
                {/* Y grid + labels */}
                {ticks.map(tick => {
                    const y = yOf(tick);
                    return (
                        <g key={tick}>
                            <line x1={PAD.left} y1={y} x2={PAD.left + plotW} y2={y}
                                stroke={gridColor} strokeWidth={1} strokeDasharray='4 4' />
                            <text x={PAD.left - 8} y={y + 4} textAnchor='end'
                                fontSize={10} fill={mutedColor}>
                                {formatTokenCount(tick)}
                            </text>
                        </g>
                    );
                })}

                {/* X labels */}
                {data.map((d, i) => {
                    if (i % xStep !== 0 && i !== data.length - 1) return null;
                    return (
                        <text key={d.date}
                            x={xOf(i) + barW / 2}
                            y={PAD.top + plotH + 18}
                            textAnchor='middle' fontSize={10} fill={mutedColor}>
                            {toDateLabel(d.date)}
                        </text>
                    );
                })}

                {/* Stacked bars */}
                {data.map((d, i) => {
                    let yOffset = PAD.top + plotH;
                    const x = xOf(i);
                    const isHovered = tooltip?.entry.date === d.date;

                    return (
                        <g key={d.date}
                            onMouseEnter={() => setTooltip({ barX: x + barW / 2, barY: yOf(d.tokens), entry: d })}
                            style={{ cursor: 'default' }}
                        >
                            {/* Invisible wide hit area */}
                            <rect x={x - barGap / 2} y={PAD.top} width={barW + barGap} height={plotH}
                                fill='transparent' />

                            {allModels.map(model => {
                                const seg = d.models[model];
                                if (!seg) return null;
                                const h = hOf(seg.tokens);
                                yOffset -= h;
                                return (
                                    <rect key={model}
                                        x={x} y={yOffset}
                                        width={barW} height={h}
                                        fill={modelColor(model, allModels)}
                                        opacity={isHovered ? 1 : 0.85}
                                        rx={barW > 6 && yOffset === PAD.top + plotH - hOf(d.tokens) ? 2 : 0}
                                    />
                                );
                            })}

                            {/* Hover highlight overlay */}
                            {isHovered && (
                                <rect x={x} y={yOf(d.tokens)} width={barW} height={hOf(d.tokens)}
                                    fill='white' opacity={0.06} rx={2} />
                            )}
                        </g>
                    );
                })}
            </svg>

            {/* Tooltip */}
            {tooltip && (() => {
                const cardW = 220;
                const flipLeft = tooltip.barX + cardW + 16 > svgWidth;
                const left = flipLeft ? tooltip.barX - cardW - 8 : tooltip.barX + 8;
                const tooltipHeight = 160;
			    const top = Math.min(
					Math.max(PAD.top, tooltip.barY - 20),
					CHART_HEIGHT - tooltipHeight
				);
			
                const sorted = Object.entries(tooltip.entry.models)
                    .sort((a, b) => b[1].tokens - a[1].tokens);

                return (
                    <div style={{
                        position: 'absolute', top, left,
                        width: cardW, pointerEvents: 'none',
                        background: 'var(--vscode-editorWidget-background)',
                        border: '1px solid var(--loophole-border-3)',
                        borderRadius: 8,
                        padding: '10px 14px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                        fontSize: 11, zIndex: 10001,
                    }}>
                        {/* Date header */}
                        <div style={{
                            fontWeight: 700, color: 'var(--loophole-fg-1)',
                            marginBottom: 8, fontSize: 12,
                            background: 'var(--loophole-bg-1)',
                            margin: '-10px -14px 8px',
                            padding: '8px 14px',
                            borderRadius: '8px 8px 0 0',
                            borderBottom: '1px solid var(--loophole-border-4)',
                        }}>
                            {toDateLabel(tooltip.entry.date)}
                        </div>

                        {/* Per-model rows */}
                        {sorted.map(([model, data]) => (
                            <div key={model} style={{
                                display: 'flex', justifyContent: 'space-between',
                                alignItems: 'center', marginBottom: 5, gap: 8,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                    <div style={{
                                        width: 3, height: 14, borderRadius: 2, flexShrink: 0,
                                        background: modelColor(model, allModels),
                                    }} />
                                    <span style={{
                                        color: 'var(--loophole-fg-2)',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>{model}</span>
                                </div>
                                <span style={{ color: 'var(--loophole-fg-1)', fontWeight: 600, flexShrink: 0 }}>
                                    {formatTokenCount(data.tokens)}
                                </span>
                            </div>
                        ))}

                        {/* Total row */}
                        <div style={{
                            borderTop: '1px solid var(--loophole-border-4)',
                            marginTop: 6, paddingTop: 6,
                            display: 'flex', justifyContent: 'space-between',
                        }}>
                            <span style={{ color: 'var(--loophole-fg-3)' }}>Total</span>
                            <span style={{ color: 'var(--loophole-fg-1)', fontWeight: 700 }}>
                                {formatTokenCount(tooltip.entry.tokens)}
                            </span>
                        </div>

                        {/* Cost row if non-zero */}
                        {tooltip.entry.cost > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                                <span style={{ color: 'var(--loophole-fg-3)' }}>Est. cost</span>
                                <span style={{ color: 'var(--loophole-fg-2)', fontWeight: 600 }}>
                                    {formatDollarCount(tooltip.entry.cost)}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })()}
        </div>
    );
};

const Legend = ({ allModels }: { allModels: string[] }) => (
    <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px 16px',
        padding: '0 24px 16px', marginTop: -4,
    }}>
        {allModels.map(model => (
            <div key={model} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{
                    width: 10, height: 10, borderRadius: 2,
                    background: modelColor(model, allModels), flexShrink: 0,
                }} />
                <span style={{ fontSize: 10, color: 'var(--loophole-fg-3)' }}>{model}</span>
            </div>
        ))}
    </div>
);

interface Props {
    isOpen: boolean;
    _ts?: number;
}

export const TokenUsageDialog = ({ isOpen: isOpenProp, _ts }: Props) => {
    const [isOpen, setIsOpen] = useState(isOpenProp);
    const isDark = useIsDark();
    const accessor = useAccessor();
    const tokenUsageService = accessor.get('ITokenUsageService');

    useEffect(() => { if (isOpenProp) setIsOpen(true); }, [isOpenProp, _ts]);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen]);

    const [dailyData, setDailyData] = useState<DailyTokenEntry[]>(() =>
        tokenUsageService.getDailyUsage()
    );

    useEffect(() => {
        const d = tokenUsageService.onTokenUsageChanged(() =>
            setDailyData(tokenUsageService.getDailyUsage())
        );
        return () => d.dispose();
    }, [tokenUsageService]);

    const close = useCallback(() => setIsOpen(false), []);

    const totalTokens = tokenUsageService.getTotalTokensUsed();
    const totalCost = tokenUsageService.getEstimatedCost();

    // Collect all unique models across all days,
    const allModels = Array.from(
        dailyData.reduce((acc, day) => {
            for (const [model, data] of Object.entries(day.models)) {
                acc.set(model, (acc.get(model) ?? 0) + data.tokens);
            }
            return acc;
        }, new Map<string, number>())
    ).sort((a, b) => b[1] - a[1]).map(([model]) => model);

    return (
        <div className={`@@loophole-scope ${isDark ? 'dark' : ''}`}>
            <div
                style={{
                    position: 'fixed', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    zIndex: 9999,
                    pointerEvents: isOpen ? 'all' : 'none',
                    opacity: isOpen ? 1 : 0,
                    transition: 'opacity 0.15s ease',
                }}
                onClick={close}
            >
                <div
                    style={{
                        background: 'var(--loophole-bg-2)',
                        border: '1px solid var(--loophole-border-3)',
                        borderRadius: 12,
                        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
                        width: 'min(900px, 92vw)',
                        overflow: 'hidden',
                        display: 'flex', flexDirection: 'column',
                        transform: isOpen ? 'scale(1)' : 'scale(0.97)',
                        transition: 'transform 0.15s ease',
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div style={{ padding: '20px 24px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--loophole-fg-1)' }}>
                                Token Usage
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--loophole-fg-3)', marginTop: 2 }}>
                                Daily usage by model
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <Pill label='Total tokens' value={formatTokenCount(totalTokens)} />
                            {totalCost > 0 && <Pill label='Est. cost' value={formatDollarCount(totalCost)} />}
                            <button
                                onClick={close}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--loophole-fg-3)', padding: '4px 6px', borderRadius: 6,
                                    display: 'flex', alignItems: 'center',
                                }}
                                title='Close (Esc)'
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Chart */}
                    <div style={{ padding: '0 24px 8px' }}>
                        <ErrorBoundary>
                            {dailyData.length === 0 ? (
                                <div style={{
                                    height: CHART_HEIGHT,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'var(--loophole-fg-3)', fontSize: 13,
                                }}>
                                    No usage recorded yet. Start a chat to see your token usage here.
                                </div>
                            ) : (
                                <UsageChart data={dailyData} allModels={allModels} />
                            )}
                        </ErrorBoundary>
                    </div>

                    {/* Legend */}
                    {allModels.length > 0 && <Legend allModels={allModels} />}
                </div>
            </div>
        </div>
    );
};

const Pill = ({ label, value }: { label: string; value: string }) => (
    <div style={{
        background: 'var(--loophole-bg-1)',
        borderRadius: 6, padding: '5px 12px', fontSize: 11,
        display: 'flex', gap: 6,
    }}>
        <span style={{ color: 'var(--loophole-fg-3)' }}>{label}</span>
        <span style={{ color: 'var(--loophole-fg-1)', fontWeight: 600 }}>{value}</span>
    </div>
);
