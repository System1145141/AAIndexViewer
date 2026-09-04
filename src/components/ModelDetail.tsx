import { useMemo } from 'react';
import type { Model } from '../types';
import { compactNumber, formatMetricValue, getMetric, METRIC_MAP, normalizeForDisplay } from '../metrics';
import { useStore } from '../store';
import { useClickOutside } from './Tooltip';

const INDEX_EVAL_KEYS = [
  'gdpval',
  'tauBanking',
  'terminalbenchV21',
  'scicode',
  'hle',
  'gpqa',
  'critpt',
  'omniscience',
  'lcr',
];

export default function ModelDetail({ model, onClose }: { model: Model; onClose: () => void }) {
  const ref = useClickOutside<HTMLDivElement>(onClose);
  const dataset = useStore((s) => s.dataset);
  const selectedIds = useStore((s) => s.selectedIds);
  const toggleSelected = useStore((s) => s.toggleSelected);

  const norm = useMemo(() => {
    const all = dataset?.models ?? [];
    const map = new Map<string, number>();
    for (const k of INDEX_EVAL_KEYS) {
      for (const [id, v] of normalizeForDisplay(all, k)) {
        map.set(`${k}:${id}`, v);
      }
    }
    return map;
  }, [dataset]);

  const evals = dataset?.evals ?? [];
  const evalMeta = new Map(evals.map((e) => [e.key, e]));

  const costBreak = model.cost.breakdownPerTask;
  const costTotal = costBreak
    ? costBreak.input + costBreak.cacheRead + costBreak.cacheWrite + costBreak.reasoning + costBreak.answer
    : 0;

  return (
    <div className="modal-mask">
      <div className="modal" ref={ref}>
        <div className="modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span
                className="dot"
                style={{ width: 10, height: 10, borderRadius: '50%', background: model.creator.color }}
              />
              <h3 style={{ margin: 0, fontSize: 17 }}>{model.name}</h3>
              {model.intelligenceIndexIsEstimated ? <span className="badge">估算值</span> : null}
            </div>
            <div style={{ color: 'var(--text-mute)', fontSize: 12, marginTop: 5 }}>
              {model.creator.name} · 发布 {model.releaseDate ?? '—'} · {dataset?.indexVersion ?? ''}
            </div>
            <div className="tags">
              {model.isOpenWeights ? <span className="tag good">开源权重</span> : <span className="tag">闭源</span>}
              {model.isReasoning ? <span className="tag">推理模型</span> : null}
              {model.sizeClass ? <span className="tag">{model.sizeClass}</span> : null}
              {model.modalities.image ? <span className="tag">图像输入</span> : null}
              {model.modalities.speech ? <span className="tag">语音输入</span> : null}
              {model.modalities.video ? <span className="tag">视频输入</span> : null}
              {model.deprecated ? <span className="tag">已下架</span> : null}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
              {formatMetricValue('intelligenceIndex', model.metrics.intelligenceIndex)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>智能指数</div>
          </div>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="modal-body">
          <div className="grid-2">
            <div className="card">
              <h4>核心指标</h4>
              {[
                'intelligenceIndex',
                'costPerTask',
                'totalCost',
                'outputTokensPerTask',
                'timePerTask',
                'outputSpeed',
              ].map((k) => (
                <div className="kv" key={k}>
                  <span>{METRIC_MAP[k]?.label ?? k}</span>
                  <span>{formatMetricValue(k, getMetric(model, k))}</span>
                </div>
              ))}
              <div style={{ marginTop: 10 }}>
                <button
                  className={`btn${selectedIds.includes(model.id) ? ' active' : ''}`}
                  style={{ width: '100%' }}
                  onClick={() => toggleSelected(model.id)}
                >
                  {selectedIds.includes(model.id) ? '已从对比中移除' : '加入对比'}
                </button>
              </div>
            </div>

            <div className="card">
              <h4>九项评测得分（相对全榜单）</h4>
              {INDEX_EVAL_KEYS.map((k) => {
                const v = getMetric(model, k);
                const n = norm.get(`${k}:${model.id}`) ?? 0;
                const meta = evalMeta.get(k);
                return (
                  <div key={k} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-dim)' }}>
                        {METRIC_MAP[k]?.label ?? k}
                        {meta ? <em style={{ color: '#4b5568', fontStyle: 'normal' }}> ·{(meta.weight * 100).toFixed(0)}%</em> : null}
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMetricValue(k, v)}</span>
                    </div>
                    <div style={{ height: 5, background: '#1a2235', borderRadius: 3, marginTop: 3 }}>
                      <div
                        style={{
                          width: `${Math.max(2, n * 100)}%`,
                          height: '100%',
                          borderRadius: 3,
                          background: 'linear-gradient(90deg,#3b7dd8,#7c5cff)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 14 }}>
            <div className="card">
              <h4>Token 用量（每任务加权均值）</h4>
              {['inputTokensPerTask', 'reasoningTokensPerTask', 'answerTokensPerTask', 'outputTokensPerTask'].map((k) => (
                <div className="kv" key={k}>
                  <span>{METRIC_MAP[k]?.label ?? k}</span>
                  <span>{formatMetricValue(k, getMetric(model, k))}</span>
                </div>
              ))}
              <div style={{ height: 10 }} />
              <h4>各评测 Token 用量（全量 / 任务数）</h4>
              {model.usage.perEval.slice(0, 12).map((e) => {
                const inTok = e.inputTokens;
                const outTok = (e.reasoningTokens ?? 0) + (e.answerTokens ?? 0);
                return (
                  <div className="kv" key={e.key}>
                    <span>
                      {e.label} <em style={{ color: '#4b5568', fontStyle: 'normal' }}>({e.taskCount})</em>
                    </span>
                    <span>
                      {inTok == null
                        ? '—'
                        : `${compactNumber(inTok, 1)} in / ${compactNumber(outTok, 1)} out`}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="card">
              <h4>成本结构（每任务）</h4>
              {costBreak && costTotal > 0 ? (
                <>
                  <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                    {(
                      [
                        ['input', '#6aa6ff'],
                        ['cacheRead', '#4ade80'],
                        ['cacheWrite', '#fbbf24'],
                        ['reasoning', '#c084fc'],
                        ['answer', '#f87171'],
                      ] as const
                    ).map(([key, color]) => (
                      <div
                        key={key}
                        title={key}
                        style={{ width: `${(costBreak[key] / costTotal) * 100}%`, background: color }}
                      />
                    ))}
                  </div>
                  {(
                    [
                      ['input', '未缓存输入'],
                      ['cacheRead', '缓存读取'],
                      ['cacheWrite', '缓存写入'],
                      ['reasoning', '推理输出'],
                      ['answer', '回答输出'],
                    ] as const
                  ).map(([key, label]) => (
                    <div className="kv" key={key}>
                      <span>{label}</span>
                      <span>
                        ${costBreak[key].toFixed(3)}
                        <em style={{ color: '#4b5568', fontStyle: 'normal' }}>
                          {' '}
                          ({((costBreak[key] / costTotal) * 100).toFixed(0)}%)
                        </em>
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="empty" style={{ padding: 12 }}>
                  该模型未公开价格数据，无法计算成本
                </div>
              )}
              <div style={{ height: 10 }} />
              <h4>定价</h4>
              {[
                ['price1mInputTokens', '输入 $/M'],
                ['price1mOutputTokens', '输出 $/M'],
                ['cacheHitPrice', '缓存命中 $/M'],
                ['cacheWritePrice', '缓存写入 $/M'],
              ].map(([k, label]) => {
                const v = getMetric(model, k);
                return (
                  <div className="kv" key={k}>
                    <span>{label}</span>
                    <span title={v == null ? '未公开，成本按输入单价估算' : undefined}>
                      {v == null ? `≈ $${getMetric(model, 'price1mInputTokens')?.toFixed(2) ?? '—'}*` : `$${v.toFixed(2)}`}
                    </span>
                  </div>
                );
              })}
              <div className="kv">
                <span>缓存命中率</span>
                <span>
                  {model.pricing.cacheHitRate == null
                    ? '—'
                    : `${(model.pricing.cacheHitRate * 100).toFixed(1)}%`}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-mute)' }}>
                * 未公开的缓存单价按输入单价估算（与源站口径一致）
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h4>其他可用指标</h4>
            <div className="grid-2" style={{ gap: '0 24px' }}>
              {Object.keys(model.metrics)
                .filter(
                  (k) =>
                    METRIC_MAP[k] &&
                    !INDEX_EVAL_KEYS.includes(k) &&
                    ![
                      'intelligenceIndex',
                      'inputTokensPerTask',
                      'outputTokensPerTask',
                      'reasoningTokensPerTask',
                      'answerTokensPerTask',
                      'costPerTask',
                      'totalCost',
                      'timePerTask',
                      'outputSpeed',
                      'price1mInputTokens',
                      'price1mOutputTokens',
                      'cacheHitPrice',
                      'cacheWritePrice',
                      'cacheHitRate',
                      'releaseTs',
                    ].includes(k) &&
                    getMetric(model, k) != null,
                )
                .map((k) => (
                  <div className="kv" key={k}>
                    <span>{METRIC_MAP[k]?.label ?? k}</span>
                    <span>{formatMetricValue(k, getMetric(model, k))}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
