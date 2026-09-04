import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MetricValue, Model } from '../types';
import { formatMetricValue, METRIC_MAP } from '../metrics';

export interface TooltipRow {
  label: string;
  value: string;
}

interface Props {
  x: number;
  y: number;
  model: Model;
  rows: TooltipRow[];
  hint?: string;
}

/** 跟随鼠标的悬浮详情卡片 */
export default function Tooltip({ x, y, model, rows, hint }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 16, top: y + 16 });

  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 160;
    let left = x + 16;
    let top = y + 16;
    if (left + w > window.innerWidth - 12) left = x - w - 16;
    if (top + h > window.innerHeight - 12) top = Math.max(12, y - h - 16);
    setPos({ left, top });
  }, [x, y, rows.length, model.id]);

  return (
    <div ref={ref} className="tooltip" style={{ left: pos.left, top: pos.top }}>
      <div className="tt-name">{model.name}</div>
      <div className="tt-sub">
        {model.creator.name}
        {model.releaseDate ? ` · ${model.releaseDate}` : ''}
      </div>
      {rows.map((r) => (
        <div className="tt-row" key={r.label}>
          <span>{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
      {hint ? <div className="tt-hint">{hint}</div> : null}
    </div>
  );
}

/** 生成模型在若干指标上的 tooltip 行 */
export function metricRows(model: Model, keys: string[]): TooltipRow[] {
  return keys
    .filter((k) => k !== 'releaseTs')
    .map((k) => ({
      label: METRIC_MAP[k]?.label ?? k,
      value: formatMetricValue(k, model.metrics[k] as MetricValue),
    }));
}

/** 点击外部时关闭（用于弹窗） */
export function useClickOutside<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  return ref;
}
