import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { AxisScale, ChartKind, Model } from '../types';
import {
  betterScore,
  formatAxis,
  formatMetricValue,
  getMetric,
  METRIC_MAP,
  normalizeForDisplay,
  plotUnit,
  plotValue,
} from '../metrics';

export interface Chart2DHandle {
  getDataURL: (caption?: string) => string | null;
}

interface Props {
  models: Model[];
  chart: ChartKind;
  xKey: string;
  yKey: string;
  sizeKey: string;
  radarKeys: string[];
  xScale: AxisScale;
  yScale: AxisScale;
  topN: number;
  showPareto: boolean;
  selectedIds: string[];
  hoverId: string | null;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}

const AXIS_LINE = '#222d45';
const TEXT_DIM = '#96a1b8';
/** 已成功定位到散点图上的模型 */
interface PlottedPoint {
  id: string;
  name: string;
  /** 绘图坐标 */
  x: number;
  y: number;
  /** 换算成"越大越优"后的分数，任一轴无方向时为 null */
  sx: number | null;
  sy: number | null;
}

/**
 * 取最优前沿（帕累托包络）：沿 X 轴分别朝"最优侧"和"最差侧"各扫一遍，
 * 只保留能刷新 Y 方向最优值的点，两段单调链合起来即紧贴最优角的完整包络
 * （最优角由两轴指标方向决定：X 越小越好、Y 越大越好时即为左上角）。
 * 结果必定包含 Y 方向全局最优的模型，并按 X 从小到大排序，连线后呈阶梯状。
 */
function paretoFrontier(points: PlottedPoint[]): PlottedPoint[] {
  const usable = points.filter((p) => p.sx != null && p.sy != null);
  if (usable.length < 2) return [];
  const kept = new Map<string, PlottedPoint>();
  // sx 为"越靠近最优角越大"的分数，dir 决定从哪一端开始扫描（同分则 Y 降序，保留更优者）
  for (const dir of [1, -1] as const) {
    const sorted = [...usable].sort((a, b) => dir * (a.sx! - b.sx!) || b.sy! - a.sy!);
    let bestY = -Infinity;
    for (const p of sorted) {
      // 该方向上已存在 Y 更优的点，说明它被包在包络线内侧
      if (p.sy! <= bestY) continue;
      kept.set(p.id, p);
      bestY = p.sy!;
    }
  }
  // 沿 X 轴从左到右，得到阶梯状前沿
  return [...kept.values()].sort((a, b) => a.x - b.x);
}

/** 用中位数划分坐标轴，返回"越优"那一角对应的矩形区域 */
function optimalQuadrant(
  points: PlottedPoint[],
  xKey: string,
  yKey: string,
): { x0: number; x1: number; y0: number; y1: number } | null {
  if (points.length < 4) return null;
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const mid = (arr: number[]) => arr[Math.floor(arr.length / 2)];
  const xm = mid(xs);
  const ym = mid(ys);
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const yMin = ys[0];
  const yMax = ys[ys.length - 1];
  if (!(xMax > xMin) || !(yMax > yMin)) return null;
  const xBetterLow = METRIC_MAP[xKey]?.better === 'low';
  const yBetterHigh = METRIC_MAP[yKey]?.better === 'high';
  return {
    x0: xBetterLow ? xMin : xm,
    x1: xBetterLow ? xm : xMax,
    y0: yBetterHigh ? ym : yMin,
    y1: yBetterHigh ? yMax : ym,
  };
}
/** 散点图图例每行最多展示的厂商数 */
const LEGEND_PER_ROW = 5;

/** ECharts 轴类型：linear -> value */
function axisType(s: AxisScale): 'value' | 'log' {
  return s === 'log' ? 'log' : 'value';
}

export const Chart2D = forwardRef<Chart2DHandle, Props>(function Chart2D(props, ref) {
  const { models, chart, xKey, yKey, sizeKey, radarKeys, xScale, yScale, topN } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const byId = useRef<Map<string, Model>>(new Map());
  /** 模型 id -> 所在的 seriesIndex / dataIndex，用于精确联动高亮 */
  const posRef = useRef<Map<string, { s: number; d: number }>>(new Map());
  /** 当前图表实际绘制出的模型数（用于提示因缺数据而未绘制的部分） */
  const [stats, setStats] = useState({ plotted: models.length, dropped: 0 });
  const statsRef = useRef({ plotted: models.length, dropped: 0 });

  useImperativeHandle(ref, () => ({
    getDataURL: () =>
      chartRef.current?.getDataURL({
        pixelRatio: 2,
        backgroundColor: '#0b0f17',
        excludeComponents: ['toolbox'],
      }) ?? null,
  }));

  useEffect(() => {
    if (!hostRef.current) return;
    const inst = echarts.init(hostRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = inst;

    inst.on('mouseover', (p) => {
      const id = (p.data as unknown as { id?: string })?.id;
      if (id) props.onHover(id);
    });
    inst.on('mouseout', () => props.onHover(null));
    inst.on('click', (p) => {
      const id = (p.data as unknown as { id?: string })?.id;
      if (id) {
        props.onOpen(id);
        props.onPick(id);
      }
    });

    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      inst.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const option = useMemo<echarts.EChartsOption>(() => {
    byId.current = new Map(models.map((m) => [m.id, m]));
    const xDef = METRIC_MAP[xKey];
    const yDef = METRIC_MAP[yKey];
    const isTimeX = xKey === 'releaseTs';
    const isTimeY = yKey === 'releaseTs';

    const base: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animationDuration: 380,
      textStyle: { fontFamily: 'Inter, Segoe UI, Microsoft YaHei, system-ui, sans-serif' },
      tooltip: {
        trigger: chart === 'radar' ? 'item' : 'item',
        backgroundColor: 'rgba(10,14,23,0.96)',
        borderColor: '#222d45',
        borderWidth: 1,
        padding: [9, 12],
        textStyle: { color: '#e8ecf5', fontSize: 12 },
        confine: true,
        formatter: (p: unknown) => {
          const param = p as { data?: { id?: string; name?: string }; name?: string };
          const id = param.data?.id;
          const model = id ? byId.current.get(id) : null;
          if (!model) return '';
          const rows: string[] = [];
          const push = (k: string) => {
            const v = getMetric(model, k);
            if (v == null) return;
            rows.push(
              `<div style="display:flex;justify-content:space-between;gap:18px">
                 <span style="color:#96a1b8">${METRIC_MAP[k]?.label ?? k}</span>
                 <b style="font-variant-numeric:tabular-nums">${formatMetricValue(k, v)}</b>
               </div>`,
            );
          };
          if (chart === 'radar') {
            for (const k of radarKeys) push(k);
          } else if (chart === 'bar') {
            push(yKey);
          } else {
            push(xKey);
            push(yKey);
            if (sizeKey !== yKey && sizeKey !== xKey) push(sizeKey);
          }
          push('intelligenceIndex');
          return `<div style="font-weight:700;margin-bottom:3px">${model.name}</div>
                  <div style="color:#6b7689;font-size:11px;margin-bottom:6px">${model.creator.name}${
                    model.releaseDate ? ` · ${model.releaseDate}` : ''
                  }</div>${rows.join('')}
                  <div style="margin-top:7px;padding-top:6px;border-top:1px solid #1a2235;color:#6b7689;font-size:11px">点击查看完整指标面板</div>`;
        },
      },
    };

    if (chart === 'radar') {
      // 优先展示已勾选对比的模型，其余按列表顺序补足
      const withData = models.filter((m) => radarKeys.some((k) => getMetric(m, k) != null));
      const picked = withData.filter((m) => props.selectedIds.includes(m.id));
      const others = withData.filter((m) => !props.selectedIds.includes(m.id));
      const shown = [...picked, ...others].slice(0, 8);
      statsRef.current = {
        plotted: shown.length,
        dropped: models.length - withData.length,
      };
      const norms = radarKeys.map((k) => normalizeForDisplay(shown.length ? shown : models, k));
      const indicators = radarKeys.map((k, i) => {
        const vals = shown.map((m) => norms[i].get(m.id) ?? 0);
        const max = Math.max(1, ...vals);
        return { name: METRIC_MAP[k]?.label ?? k, max: Math.max(max * 1.1, 1) };
      });
      return {
        ...base,
        legend: {
          type: 'scroll',
          bottom: 4,
          textStyle: { color: TEXT_DIM, fontSize: 11 },
          data: shown.map((m) => m.shortName),
        },
        radar: {
          center: ['50%', '48%'],
          radius: '66%',
          splitNumber: 4,
          axisName: { color: TEXT_DIM, fontSize: 11 },
          splitLine: { lineStyle: { color: '#1e2942' } },
          splitArea: { areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.035)'] } },
          axisLine: { lineStyle: { color: '#1e2942' } },
          indicator: indicators,
        },
        series: [
          {
            type: 'radar',
            symbolSize: 5,
            data: shown.map((m) => ({
              id: m.id,
              name: m.shortName,
              value: radarKeys.map((_, i) => norms[i].get(m.id) ?? 0),
              lineStyle: { color: m.creator.color, width: 2 },
              itemStyle: { color: m.creator.color },
              areaStyle: { color: hexA(m.creator.color, 0.12) },
            })),
          },
        ],
      } as echarts.EChartsOption;
    }

    if (chart === 'bar') {
      const withValue = models
        .map((m) => ({ m, v: plotValue(yKey, getMetric(m, yKey)) }))
        .filter((r) => r.v != null && Number.isFinite(r.v));
      const rows = [...withValue]
        .sort((a, b) => (yDef?.better === 'low' ? a.v! - b.v! : b.v! - a.v!))
        .slice(0, topN);
      statsRef.current = { plotted: rows.length, dropped: models.length - withValue.length };
      return {
        ...base,
        grid: { left: 62, right: 24, top: 44, bottom: 92 },
        xAxis: {
          type: 'category',
          data: rows.map((r) => r.m.shortName),
          axisLabel: { color: TEXT_DIM, fontSize: 11, interval: 0, rotate: 32, hideOverlap: true },
          axisLine: { lineStyle: { color: AXIS_LINE } },
          axisTick: { show: false },
        },
        yAxis: {
          type: axisType(yScale),
          name: `${yDef?.label ?? yKey}${plotUnit(yKey) ? ` (${plotUnit(yKey)})` : ''}`,
          nameTextStyle: { color: TEXT_DIM, fontSize: 11, align: 'left' },
          nameGap: 16,
          axisLabel: { color: TEXT_DIM, fontSize: 11, formatter: (v: number) => formatAxis(yKey, v) },
          splitLine: { lineStyle: { color: '#161e30' } },
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 42,
            data: rows.map((r) => ({
              id: r.m.id,
              name: r.m.shortName,
              value: r.v,
              itemStyle: {
                color: r.m.creator.color,
                opacity: props.selectedIds.length && !props.selectedIds.includes(r.m.id) ? 0.32 : 0.92,
                borderRadius: [4, 4, 0, 0],
              },
            })),
            emphasis: { itemStyle: { opacity: 1 } },
          },
        ],
      } as echarts.EChartsOption;
    }

    // 散点图：按厂商分系列，便于图例筛选
    const sizeNorm = normalizeForDisplay(models, sizeKey);
    const groups = new Map<string, Model[]>();
    const plotted: PlottedPoint[] = [];
    let droppedByAxis = 0;
    for (const m of models) {
      const xv = plotValue(xKey, getMetric(m, xKey));
      const yv = plotValue(yKey, getMetric(m, yKey));
      const ok =
        xv != null &&
        yv != null &&
        Number.isFinite(xv) &&
        Number.isFinite(yv) &&
        !(xScale === 'log' && xv <= 0) &&
        !(yScale === 'log' && yv <= 0);
      if (!ok) {
        droppedByAxis += 1;
        continue;
      }
      plotted.push({ id: m.id, name: m.name, x: xv, y: yv, sx: betterScore(xKey, xv), sy: betterScore(yKey, yv) });
      const arr = groups.get(m.creator.slug) ?? [];
      arr.push(m);
      groups.set(m.creator.slug, arr);
    }
    statsRef.current = { plotted: models.length - droppedByAxis, dropped: droppedByAxis };

    // 已勾选的模型在气泡旁直接标注名称：按所处位置挑一个不会被边界裁掉的方向
    const selected = new Set(props.selectedIds);
    const xs = plotted.map((p) => p.x);
    const ys = plotted.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const isLogX = xScale === 'log' && !isTimeX;
    const isLogY = yScale === 'log' && !isTimeY;
    const frac = (v: number, min: number, max: number, log: boolean) => {
      if (!(max > min)) return 0.5;
      return log
        ? (Math.log(Math.max(v, min)) - Math.log(min)) / (Math.log(max) - Math.log(min))
        : (v - min) / (max - min);
    };
    const labelPosition = (x: number, y: number): 'top' | 'bottom' | 'left' => {
      if (frac(x, xMin, xMax, isLogX) > 0.82) return 'left';
      if (frac(y, yMin, yMax, isLogY) > 0.88) return 'bottom';
      return 'top';
    };

    const series = [...groups.entries()].map(([slug, list]) => {
      const first = list[0];
      return {
        id: slug,
        name: first.creator.name,
        type: 'scatter' as const,
        symbolSize: (val: unknown) => {
          const d = val as { id?: string };
          const n = d?.id ? sizeNorm.get(d.id) ?? 0.35 : 0.35;
          return 4.5 + Math.sqrt(Math.max(0, n)) * 15;
        },
        itemStyle: {
          color: first.creator.color,
          opacity: 0.82,
          borderColor: 'rgba(255,255,255,0.28)',
          borderWidth: 1,
        },
        emphasis: { scale: 1.12, itemStyle: { opacity: 1, borderWidth: 2 } },
        // 含已勾选模型的系列整体提到上层，避免名称被其他厂商的气泡盖住
        z: list.some((m) => selected.has(m.id)) ? 6 : 2,
        // 勾选较多时自动隐藏互相重叠的名称，避免糊成一片
        labelLayout: { hideOverlap: true },
        data: list.map((m) => {
          const xv = plotValue(xKey, getMetric(m, xKey))!;
          const yv = plotValue(yKey, getMetric(m, yKey))!;
          const on = selected.has(m.id);
          return {
            id: m.id,
            name: m.name,
            value: [xv, yv],
            itemStyle: on
              ? { color: first.creator.color, opacity: 1, borderColor: '#fff', borderWidth: 2 }
              : undefined,
            label: on
              ? {
                  show: true,
                  position: labelPosition(xv, yv),
                  distance: 8,
                  formatter: m.shortName,
                  color: '#f2f5fb',
                  fontSize: 11,
                  fontWeight: 600 as const,
                  // 描边保证在任何气泡颜色上都能看清
                  textBorderColor: 'rgba(8,11,18,0.92)',
                  textBorderWidth: 3,
                }
              : undefined,
          };
        }),
      };
    });

    // 帕累托前沿：按两轴"越大越优"的方向取非支配解，再沿 X 轴从左到右连成阶梯线
    const pareto = props.showPareto ? paretoFrontier(plotted) : [];
    const quadrant = props.showPareto ? optimalQuadrant(plotted, xKey, yKey) : null;
    if (pareto.length > 1) {
      series.push({
        id: '__pareto',
        name: 'Pareto 前沿',
        type: 'line' as const,
        // 置于最上层，避免被气泡遮住
        z: 12,
        symbol: 'circle' as const,
        symbolSize: 7,
        showSymbol: true,
        data: pareto.map((p) => ({ value: [p.x, p.y], id: p.id, name: p.name })),
        lineStyle: { color: '#7ee787', width: 1.5, type: 'dashed' as const },
        itemStyle: { color: '#7ee787', borderColor: '#0b0f17', borderWidth: 1.5 },
        emphasis: { scale: 1.4, itemStyle: { color: '#7ee787', borderColor: '#fff', borderWidth: 2 } },
        endLabel: {
          show: true,
          formatter: 'Pareto 前沿',
          color: '#7ee787',
          fontSize: 11,
          distance: 6,
        },
        ...(quadrant
          ? {
              markArea: {
                silent: true,
                itemStyle: {
                  color: 'rgba(126,231,135,0.055)',
                  borderColor: 'rgba(126,231,135,0.3)',
                  borderWidth: 1,
                  borderType: 'dashed' as const,
                },
                label: {
                  show: true,
                  position: 'insideTop' as const,
                  formatter: '最优区间',
                  color: 'rgba(126,231,135,0.72)',
                  fontSize: 11,
                },
                data: [[{ xAxis: quadrant.x0, yAxis: quadrant.y0 }, { xAxis: quadrant.x1, yAxis: quadrant.y1 }]],
              },
            }
          : {}),
      } as never);
    }

    // 记录每个模型所在的 seriesIndex / dataIndex，供外部 hover 联动精确高亮
    posRef.current = new Map();
    series.forEach((s, si) => {
      const list = (s as { data?: { id?: string }[] }).data ?? [];
      list.forEach((d, di) => {
        if (d?.id) posRef.current.set(d.id, { s: si, d: di });
      });
    });

    // 厂商较多时换行展示，避免滚动图例折叠掉大部分厂商
    const creatorNames = [...groups.values()].map((list) => list[0].creator.name);
    const rows: string[][] = [];
    for (let i = 0; i < creatorNames.length; i += LEGEND_PER_ROW) {
      rows.push(creatorNames.slice(i, i + LEGEND_PER_ROW));
    }
    const legendTop = 6;
    const legendRowH = 20;
    const gridTop = 44 + Math.max(0, rows.length - 1) * legendRowH;

    return {
      ...base,
      legend: rows.map((data, i) => ({
        type: 'plain' as const,
        top: legendTop + i * legendRowH,
        left: 'center' as const,
        data,
        textStyle: { color: TEXT_DIM, fontSize: 11 },
        inactiveColor: '#4a5570',
        itemWidth: 14,
        itemHeight: 9,
        itemGap: 12,
      })),
      grid: { left: 66, right: 30, top: gridTop, bottom: 58 },
      xAxis: {
        type: isTimeX ? 'time' : axisType(xScale),
        scale: !isTimeX && xScale === 'linear',
        name: `${xDef?.label ?? xKey}${plotUnit(xKey) ? ` (${plotUnit(xKey)})` : ''}`,
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: TEXT_DIM, fontSize: 11 },
        axisLabel: {
          color: TEXT_DIM,
          fontSize: 11,
          formatter: isTimeX ? undefined : (v: number) => formatAxis(xKey, v),
        },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        splitLine: { lineStyle: { color: '#141c2c' } },
      },
      yAxis: {
        type: isTimeY ? 'time' : axisType(yScale),
        scale: !isTimeY && yScale === 'linear',
        name: `${yDef?.label ?? yKey}${plotUnit(yKey) ? ` (${plotUnit(yKey)})` : ''}`,
        nameTextStyle: { color: TEXT_DIM, fontSize: 11, align: 'left' },
        nameGap: 14,
        axisLabel: {
          color: TEXT_DIM,
          fontSize: 11,
          formatter: isTimeY ? undefined : (v: number) => formatAxis(yKey, v),
        },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        splitLine: { lineStyle: { color: '#141c2c' } },
      },
      series,
    } as echarts.EChartsOption;
  }, [
    models,
    chart,
    xKey,
    yKey,
    sizeKey,
    radarKeys,
    xScale,
    yScale,
    topN,
    props.selectedIds,
    props.showPareto,
  ]);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
    setStats(statsRef.current);
  }, [option]);

  useEffect(() => {
    const inst = chartRef.current;
    if (!inst) return;
    const id = props.hoverId;
    if (!id) {
      inst.dispatchAction({ type: 'downplay' });
      return;
    }
    const pos = posRef.current.get(id);
    if (!pos) return;
    inst.dispatchAction({ type: 'highlight', seriesIndex: pos.s, dataIndex: pos.d });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.hoverId, models]);

  return (
    <div className="chart-canvas">
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {stats.dropped > 0 ? (
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 10,
            fontSize: 11,
            color: '#c9a227',
            background: 'rgba(11,15,23,0.86)',
            border: '1px solid rgba(251,191,36,0.35)',
            borderRadius: 8,
            padding: '4px 9px',
            pointerEvents: 'none',
          }}
        >
          已绘制 {stats.plotted}/{models.length} 个模型 · 其余 {stats.dropped} 个缺少
          {chart === 'scatter' ? ' X/Y 轴' : chart === 'bar' ? ' Y 轴' : ' 雷达维度'}指标数据，无法定位（更换指标可显示更多）
        </div>
      ) : null}
    </div>
  );
});

function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(122,162,247,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
