import { useMemo } from 'react';
import { useStore } from '../store';
import type { Model } from '../types';
import { formatMetricValue, getMetric, METRICS, METRIC_MAP } from '../metrics';
import { exportModelsCSV, renderCompareImage, timestamp, downloadDataURL } from '../utils/exporters';

export default function CompareDock() {
  const models = useStore((s) => s.dataset?.models ?? []);
  const selectedIds = useStore((s) => s.selectedIds);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const clearSelected = useStore((s) => s.clearSelected);
  const setCompareOpen = useStore((s) => s.setCompareOpen);
  const setDetail = useStore((s) => s.setDetail);
  const dataset = useStore((s) => s.dataset);
  const showToast = useStore((s) => s.showToast);

  const picked = useMemo(() => {
    const map = new Map(models.map((m) => [m.id, m]));
    return selectedIds.map((id) => map.get(id)).filter((m): m is Model => !!m);
  }, [models, selectedIds]);

  const metricKeys = useMemo(
    () =>
      METRICS.map((m) => m.key).filter((k) => picked.some((m) => getMetric(m, k) != null)),
    [picked],
  );

  const summary = useMemo(() => buildSummary(picked), [picked]);

  if (!picked.length) return null;

  const caption = dataset
    ? `${dataset.indexVersion} · ${new Date(dataset.fetchedAt).toLocaleString('zh-CN')}`
    : '';

  return (
    <div className="compare-dock">
      <div className="compare-head">
        <strong style={{ fontSize: 13 }}>模型对比</strong>
        <span className="badge">{picked.length} 个模型 · {metricKeys.length} 项指标</span>
        <div style={{ flex: 1 }} />
        <button
          className="btn sm"
          onClick={() => {
            exportModelsCSV(picked, metricKeys, `aa-compare-${timestamp()}.csv`);
            showToast('对比结果已导出为 CSV');
          }}
        >
          导出 CSV
        </button>
        <button
          className="btn sm"
          onClick={() => {
            const url = renderCompareImage({
              models: picked,
              metricKeys,
              title: 'Artificial Analysis 智能指数 · 模型对比',
              subtitle: caption,
            });
            downloadDataURL(url, `aa-compare-${timestamp()}.png`);
            showToast('对比结果已导出为 PNG');
          }}
        >
          导出 PNG
        </button>
        <button className="btn sm" onClick={() => setCompareOpen(false)}>
          收起
        </button>
        <button className="btn sm" onClick={clearSelected}>
          清空
        </button>
      </div>

      <div className="compare-body">
        <table className="cmp">
          <thead>
            <tr>
              <th>指标</th>
              {picked.map((m) => (
                <th key={m.id}>
                  <div
                    className="cmp-model-head"
                    title={m.name}
                    onDoubleClick={() => setDetail(m.id)}
                  >
                    <span className="dot" style={{ background: m.creator.color }} />
                    <span>{m.shortName}</span>
                    <button
                      className="btn sm"
                      style={{ padding: '0 5px', lineHeight: '16px' }}
                      onClick={() => toggleSelected(m.id)}
                      title="移出对比"
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricKeys.map((key) => {
              const def = METRIC_MAP[key];
              const vals = picked.map((m) => getMetric(m, key));
              const present = vals.filter((v): v is number => v != null);
              const best = present.length > 1 ? (def?.better === 'low' ? Math.min(...present) : Math.max(...present)) : null;
              const worst = present.length > 1 ? (def?.better === 'low' ? Math.max(...present) : Math.min(...present)) : null;
              const base = vals[0];
              return (
                <tr key={key}>
                  <td title={def?.hint}>{def?.label ?? key}</td>
                  {picked.map((m, i) => {
                    const v = vals[i];
                    const cls = v == null ? '' : v === best ? 'best' : v === worst && best !== worst ? 'worst' : '';
                    let delta = '';
                    if (i > 0 && v != null && base != null && base !== 0) {
                      const p = ((v - base) / Math.abs(base)) * 100;
                      if (Math.abs(p) >= 0.05) delta = `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
                    }
                    return (
                      <td key={m.id} className={cls}>
                        {formatMetricValue(key, v)}
                        {delta ? <span className="delta"> {delta}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {summary ? <div className="summary" dangerouslySetInnerHTML={{ __html: summary }} /> : null}
      </div>
    </div>
  );
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

/** 生成对比摘要：极值归属 + 差异最大的指标 */
function buildSummary(models: Model[]): string {
  if (models.length < 2) {
    return models.length === 1
      ? `已选择 <b>${esc(models[0].name)}</b>。再选择一个模型即可生成对比摘要。`
      : '';
  }

  const lines: string[] = [];
  lines.push(`共对比 <b>${models.length}</b> 个模型，覆盖 ${METRICS.length} 项指标中的可用项。`);

  const pick = (key: string, better: 'high' | 'low') => {
    const vals = models
      .map((m) => ({ m, v: getMetric(m, key) }))
      .filter((x): x is { m: Model; v: number } => x.v != null);
    if (!vals.length) return null;
    vals.sort((a, b) => (better === 'high' ? b.v - a.v : a.v - b.v));
    return { best: vals[0], worst: vals[vals.length - 1], count: vals.length };
  };

  const idx = pick('intelligenceIndex', 'high');
  if (idx && idx.count >= 2) {
    const gap = idx.best.v - idx.worst.v;
    lines.push(
      `智能指数最高的是 <b>${esc(idx.best.m.shortName)}</b>（${idx.best.v.toFixed(1)}），` +
        `比最低的 ${esc(idx.worst.m.shortName)}（${idx.worst.v.toFixed(1)}）高 <b>${gap.toFixed(1)}</b> 分。`,
    );
  }

  const cost = pick('costPerTask', 'low');
  if (cost && cost.count >= 2 && cost.worst.v > 0) {
    const ratio = cost.worst.v / Math.max(cost.best.v, 1e-9);
    lines.push(
      `每任务花费最低的是 <b>${esc(cost.best.m.shortName)}</b>（${formatMetricValue('costPerTask', cost.best.v)}），` +
        `仅为最贵模型 ${esc(cost.worst.m.shortName)}（${formatMetricValue('costPerTask', cost.worst.v)}）的 ` +
        `<b>${(100 / ratio).toFixed(0)}%</b>。`,
    );
  }

  const speed = pick('outputSpeed', 'high');
  if (speed && speed.count >= 2 && speed.best.v > 0) {
    lines.push(
      `输出速度最快的是 <b>${esc(speed.best.m.shortName)}</b>（${speed.best.v.toFixed(0)} tok/s），` +
        `约为最慢模型 ${esc(speed.worst.m.shortName)}（${speed.worst.v.toFixed(0)} tok/s）的 ` +
        `<b>${(speed.best.v / Math.max(speed.worst.v, 1e-9)).toFixed(1)} 倍</b>。`,
    );
  }

  const tokens = pick('outputTokensPerTask', 'low');
  if (tokens && tokens.count >= 2 && tokens.best.v > 0) {
    lines.push(
      `思考成本（每任务输出 Token）最节省的是 <b>${esc(tokens.best.m.shortName)}</b>` +
        `（${Math.round(tokens.best.v)} tok），最"啰嗦"的是 ${esc(tokens.worst.m.shortName)}` +
        `（${Math.round(tokens.worst.v)} tok）。`,
    );
  }

  // 差异最大的指标（正数值的极差倍数）
  let top: { label: string; ratio: number; hi: string; lo: string } | null = null;
  for (const def of METRICS) {
    if (def.scale === 'date') continue;
    const vals = models
      .map((m) => ({ n: m.shortName, v: getMetric(m, def.key) }))
      .filter((x): x is { n: string; v: number } => x.v != null && x.v > 0);
    if (vals.length < 2) continue;
    const max = Math.max(...vals.map((x) => x.v));
    const min = Math.min(...vals.map((x) => x.v));
    const ratio = max / min;
    if (ratio > 1.05 && (!top || ratio > top.ratio)) {
      top = {
        label: def.label,
        ratio,
        hi: vals.find((x) => x.v === max)!.n,
        lo: vals.find((x) => x.v === min)!.n,
      };
    }
  }
  if (top) {
    lines.push(
      `差异最大的指标是 <b>${esc(top.label)}</b>：${esc(top.hi)} 是 ${esc(top.lo)} 的 ` +
        `<b>${top.ratio.toFixed(1)} 倍</b>。`,
    );
  }

  return `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
}
