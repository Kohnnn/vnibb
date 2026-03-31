'use client';

import { useMemo } from 'react';

import { EMPTY_VALUE, formatPercent } from '@/lib/units';
import type { FinancialFlowLink, IncomeSankeyModel } from '@/lib/financialVisualizations';

interface IncomeSankeyChartProps {
  model: IncomeSankeyModel;
  formatValue: (value: number) => string;
}

interface LaidOutNode {
  id: string;
  label: string;
  value: number;
  stage: number;
  tone: string;
  changePct?: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  outCursor: number;
  inCursor: number;
}

interface LaidOutLink extends FinancialFlowLink {
  thickness: number;
  sourceX: number;
  targetX: number;
  sourceY: number;
  targetY: number;
}

const STAGE_X = [72, 280, 490, 700, 910];
const NODE_WIDTH = 18;
const SVG_WIDTH = 1120;
const SVG_HEIGHT = 420;
const INNER_TOP = 36;
const INNER_HEIGHT = 300;
const MIN_NODE_HEIGHT = 20;
const STAGE_GAP = 18;

function formatDelta(changePct: number | null | undefined): string {
  if (changePct === null || changePct === undefined) return '';
  const formatted = formatPercent(changePct, { decimals: 1, input: 'percent', clamp: 'yoy_change' });
  return formatted === EMPTY_VALUE ? '' : `${changePct > 0 ? '+' : ''}${formatted}`;
}

export function IncomeSankeyChart({ model, formatValue }: IncomeSankeyChartProps) {
  const { nodes, links, maxValue } = model;

  const laidOut = useMemo(() => {
    const stageMap = new Map<number, typeof nodes>();
    nodes.forEach((node) => {
      const stageNodes = stageMap.get(node.stage) ?? [];
      stageNodes.push(node);
      stageMap.set(node.stage, stageNodes);
    });

    const nodeMap = new Map<string, LaidOutNode>();
    stageMap.forEach((stageNodes, stage) => {
      const rawHeights = stageNodes.map((node) => Math.max((node.value / Math.max(maxValue, 1)) * INNER_HEIGHT, MIN_NODE_HEIGHT));
      const totalHeight = rawHeights.reduce((sum, height) => sum + height, 0) + STAGE_GAP * Math.max(stageNodes.length - 1, 0);
      let currentY = INNER_TOP + Math.max((INNER_HEIGHT - totalHeight) / 2, 0);

      stageNodes.forEach((node, index) => {
        const height = rawHeights[index];
        nodeMap.set(node.id, {
          ...node,
          x: STAGE_X[stage] ?? STAGE_X[STAGE_X.length - 1],
          y: currentY,
          width: NODE_WIDTH,
          height,
          outCursor: currentY,
          inCursor: currentY,
        });
        currentY += height + STAGE_GAP;
      });
    });

      const laidOutLinks = links.map((link): LaidOutLink | null => {
        const source = nodeMap.get(link.source);
        const target = nodeMap.get(link.target);
        if (!source || !target || source.value <= 0 || target.value <= 0) return null;

      const sourceThickness = Math.max((link.value / source.value) * source.height, 6);
      const targetThickness = Math.max((link.value / target.value) * target.height, 6);
      const thickness = Math.min(sourceThickness, targetThickness);
      const sourceY = source.outCursor + thickness / 2;
      const targetY = target.inCursor + thickness / 2;

      source.outCursor += thickness;
      target.inCursor += thickness;

      return {
        ...link,
        thickness,
        sourceX: source.x + source.width,
        targetX: target.x,
        sourceY,
        targetY,
      };
      }).filter((link): link is LaidOutLink => link !== null);

    return {
      nodeMap,
      links: laidOutLinks,
    };
  }, [links, maxValue, nodes]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        <SummaryCard label="Revenue" value={formatValue(model.metrics.revenue)} tone="text-blue-300" />
        <SummaryCard label="Gross Profit" value={formatValue(model.metrics.grossProfit)} tone="text-cyan-300" />
        <SummaryCard label="Operating Income" value={formatValue(model.metrics.operatingIncome)} tone="text-emerald-300" />
        <SummaryCard label="Pre-tax Profit" value={formatValue(model.metrics.preTaxProfit)} tone="text-teal-300" />
        <SummaryCard label="Net Income" value={formatValue(model.metrics.netIncome)} tone="text-emerald-200" />
      </div>

      <div className="min-h-[360px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-full w-full">
          {laidOut.links.map((link, index) => (
            <path
              key={`${link.source}-${link.target}-${index}`}
              d={`M ${link.sourceX} ${link.sourceY} C ${link.sourceX + 70} ${link.sourceY}, ${link.targetX - 70} ${link.targetY}, ${link.targetX} ${link.targetY}`}
              fill="none"
              stroke={link.tone}
              strokeOpacity="0.55"
              strokeWidth={link.thickness}
              strokeLinecap="round"
            />
          ))}

          {Array.from(laidOut.nodeMap.values()).map((node) => {
            const delta = formatDelta(node.changePct);
            return (
              <g key={node.id}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={4}
                  fill={node.tone}
                  opacity={0.95}
                />
                <text
                  x={node.x + node.width + 10}
                  y={node.y + 16}
                  fill="var(--text-primary)"
                  fontSize="13"
                  fontWeight="600"
                >
                  {node.label}
                </text>
                <text
                  x={node.x + node.width + 10}
                  y={node.y + 33}
                  fill="var(--text-secondary)"
                  fontSize="12"
                >
                  {formatValue(node.value)}
                  {delta ? `  ${delta}` : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default IncomeSankeyChart;
