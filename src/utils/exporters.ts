import type { Model } from '../types';
import { formatMetricValue, getMetric, METRIC_MAP } from '../metrics';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadDataURL(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 导出模型数据为 CSV（UTF-8 BOM，兼容 Excel） */
export function exportModelsCSV(models: Model[], metricKeys: string[], filename: string) {
  const header = ['模型', '厂商', '发布日期', '开源权重', '推理模型', ...metricKeys.map((k) => METRIC_MAP[k]?.label ?? k)];
  const lines = [header.map(escapeCsv).join(',')];
  for (const m of models) {
    const row = [
      m.name,
      m.creator.name,
      m.releaseDate ?? '',
      m.isOpenWeights ? '是' : '否',
      m.isReasoning ? '是' : '否',
      ...metricKeys.map((k) => {
        const v = getMetric(m, k);
        return v == null ? '' : String(roundForCsv(v));
      }),
    ];
    lines.push(row.map(escapeCsv).join(','));
  }
  const blob = new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
}

function escapeCsv(v: string | number): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function roundForCsv(v: number): number {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return Number(v.toFixed(digits));
}

const FONT = '600 13px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const FONT_SM = '12px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const FONT_BOLD = '700 13px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(122,162,247,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export interface CompareExportOptions {
  models: Model[];
  metricKeys: string[];
  title: string;
  subtitle: string;
}

/**
 * 将对比结果渲染为一张图片（纯 Canvas 绘制，无额外依赖）。
 * 每行指标的最优值会高亮，并给出相对首列的差值。
 */
export function renderCompareImage({ models, metricKeys, title, subtitle }: CompareExportOptions): string {
  const pad = 32;
  const rowH = 34;
  const headH = 96;
  const labelW = 230;
  const colW = 168;
  const width = Math.max(760, pad * 2 + labelW + colW * models.length);
  const height = pad * 2 + headH + (metricKeys.length + 1) * rowH + 56;

  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0b0f17');
  bg.addColorStop(1, '#121a29');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#e8ecf5';
  ctx.font = '700 22px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
  ctx.fillText(title, pad, pad + 26);
  ctx.fillStyle = '#8b96ad';
  ctx.font = FONT_SM;
  ctx.fillText(subtitle, pad, pad + 50);

  // 图例
  let lx = pad;
  const ly = pad + 74;
  for (const m of models) {
    ctx.fillStyle = m.creator.color;
    ctx.beginPath();
    ctx.arc(lx + 5, ly - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c7d0e0';
    ctx.font = FONT_SM;
    ctx.fillText(truncate(ctx, m.shortName, colW - 22), lx + 16, ly);
    lx += colW;
  }

  const tableTop = pad + headH;
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(pad, tableTop, width - pad * 2, rowH);

  const colX = (i: number) => pad + labelW + i * colW;

  ctx.fillStyle = '#8b96ad';
  ctx.font = FONT;
  ctx.fillText('指标', pad + 14, tableTop + rowH / 2 + 4);
  models.forEach((m, i) => {
    ctx.fillStyle = '#e8ecf5';
    ctx.font = FONT;
    ctx.fillText(truncate(ctx, m.shortName, colW - 24), colX(i) + 14, tableTop + rowH / 2 + 4);
  });

  metricKeys.forEach((key, r) => {
    const y = tableTop + (r + 1) * rowH;
    if (r % 2 === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(pad, y, width - pad * 2, rowH);
    }
    const def = METRIC_MAP[key];
    ctx.fillStyle = '#c7d0e0';
    ctx.font = FONT_SM;
    ctx.fillText(truncate(ctx, def?.label ?? key, labelW - 24), pad + 14, y + rowH / 2 + 4);

    const vals = models.map((m) => getMetric(m, key));
    const present = vals.filter((v): v is number => v != null);
    const best = def?.better === 'low' ? Math.min(...present) : Math.max(...present);
    const base = vals[0];

    vals.forEach((v, i) => {
      const x = colX(i) + 14;
      if (v == null) {
        ctx.fillStyle = '#5c6678';
        ctx.font = FONT_SM;
        ctx.fillText('—', x, y + rowH / 2 + 4);
        return;
      }
      const isBest = present.length > 1 && v === best;
      ctx.fillStyle = isBest ? '#4ade80' : '#e8ecf5';
      ctx.font = isBest ? FONT_BOLD : FONT_SM;
      ctx.fillText(formatMetricValue(key, v), x, y + rowH / 2 + 4);

      if (i > 0 && base != null && base !== 0) {
        const delta = ((v - base) / Math.abs(base)) * 100;
        if (Math.abs(delta) >= 0.05) {
          const better = def?.better === 'low' ? delta < 0 : delta > 0;
          ctx.fillStyle = better ? 'rgba(74,222,128,0.85)' : 'rgba(248,113,113,0.85)';
          ctx.font = FONT_SM;
          ctx.fillText(`${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`, x + 82, y + rowH / 2 + 4);
        }
      }
    });
  });

  const footY = tableTop + (metricKeys.length + 1) * rowH + 30;
  ctx.fillStyle = '#5c6678';
  ctx.font = FONT_SM;
  ctx.fillText(
    `数据来源：Artificial Analysis Intelligence Index · ${subtitle} · 由 AA 智能指数可视化探索器生成`,
    pad,
    footY,
  );

  return canvas.toDataURL('image/png');
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/** 在图片外围追加水印条（用于图表导出） */
export function withWatermark(dataUrl: string, caption: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const pad = 16;
      const barH = 34;
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height + barH + pad * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0b0f17';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, pad);
      ctx.fillStyle = '#8b96ad';
      ctx.font = `${Math.round(img.width / 90)}px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`;
      ctx.fillText(caption, pad, canvas.height - 12);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export { hexToRgba };
