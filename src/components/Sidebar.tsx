import { useMemo } from 'react';
import { applyFilters, applySort, useStore } from '../store';
import { formatMetricValue, getMetric, METRICS, METRIC_MAP } from '../metrics';
import type { Creator } from '../types';

export default function Sidebar({ visibleModels }: { visibleModels: ReturnType<typeof applyFilters> }) {
  const dataset = useStore((s) => s.dataset);
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilters = useStore((s) => s.resetFilters);
  const sortKey = useStore((s) => s.sortKey);
  const sortDir = useStore((s) => s.sortDir);
  const setPref = useStore((s) => s.setPref);
  const selectedIds = useStore((s) => s.selectedIds);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const setDetail = useStore((s) => s.setDetail);
  const setHover = useStore((s) => s.setHover);
  const hoverId = useStore((s) => s.hoverId);
  const status = useStore((s) => s.status);
  const loadDataset = useStore((s) => s.loadDataset);

  const creators = useMemo(() => {
    const map = new Map<string, Creator & { count: number }>();
    for (const m of dataset?.models ?? []) {
      const cur = map.get(m.creator.slug);
      if (cur) cur.count += 1;
      else map.set(m.creator.slug, { ...m.creator, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [dataset]);

  const rows = useMemo(
    () => applySort(visibleModels, sortKey, sortDir),
    [visibleModels, sortKey, sortDir],
  );

  const activeFilterCount =
    (filters.search ? 1 : 0) +
    filters.creators.length +
    (filters.openWeightsOnly ? 1 : 0) +
    (filters.reasoningOnly ? 1 : 0) +
    (filters.requireCost ? 1 : 0) +
    (filters.requireSpeed ? 1 : 0) +
    (filters.minIndex > 0 ? 1 : 0);

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="section">
          <div className="section-title">
            <span>筛选条件</span>
            {activeFilterCount > 0 ? (
              <button className="btn sm" onClick={resetFilters}>
                重置 ({activeFilterCount})
              </button>
            ) : null}
          </div>
          <div className="field">
            <input
              type="search"
              placeholder="搜索模型 / 厂商…"
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
            />
          </div>
          <div style={{ height: 10 }} />
          <label className="check">
            <input
              type="checkbox"
              checked={filters.hideDeprecated}
              onChange={(e) => setFilter('hideDeprecated', e.target.checked)}
            />
            隐藏已下架模型
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filters.openWeightsOnly}
              onChange={(e) => setFilter('openWeightsOnly', e.target.checked)}
            />
            仅开源权重
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filters.reasoningOnly}
              onChange={(e) => setFilter('reasoningOnly', e.target.checked)}
            />
            仅推理模型
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filters.requireCost}
              onChange={(e) => setFilter('requireCost', e.target.checked)}
            />
            仅含成本数据
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filters.requireSpeed}
              onChange={(e) => setFilter('requireSpeed', e.target.checked)}
            />
            仅含速度数据
          </label>
          <div style={{ height: 10 }} />
          <div className="field">
            <label>智能指数下限 · {filters.minIndex.toFixed(0)}</label>
            <input
              type="range"
              min={0}
              max={70}
              step={1}
              value={filters.minIndex}
              onChange={(e) => setFilter('minIndex', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <span>厂商</span>
            {filters.creators.length ? (
              <button className="btn sm" onClick={() => setFilter('creators', [])}>
                清空
              </button>
            ) : null}
          </div>
          <div className="chips">
            {creators.map((c) => {
              const on = filters.creators.includes(c.slug);
              return (
                <button
                  key={c.slug}
                  className={`chip${on ? ' on' : ''}`}
                  onClick={() =>
                    setFilter(
                      'creators',
                      on ? filters.creators.filter((x) => x !== c.slug) : [...filters.creators, c.slug],
                    )
                  }
                >
                  <span className="dot" style={{ background: c.color }} />
                  {c.name}
                  <span style={{ color: '#5c6678' }}>{c.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <span>排序</span>
            <button
              className="btn sm"
              onClick={() => setPref('sortDir', sortDir === 'desc' ? 'asc' : 'desc')}
            >
              {sortDir === 'desc' ? '降序 ↓' : '升序 ↑'}
            </button>
          </div>
          <div className="field">
            <select value={sortKey} onChange={(e) => setPref('sortKey', e.target.value)}>
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.group} · {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="section" style={{ borderBottom: 'none', paddingBottom: 6 }}>
          <div className="section-title">
            <span>模型列表 · {rows.length}</span>
            {selectedIds.length ? (
              <button className="btn sm" onClick={() => useStore.getState().clearSelected()}>
                清空选中 ({selectedIds.length})
              </button>
            ) : null}
          </div>
        </div>

        <div className="model-list">
          {rows.map((m) => {
            const sel = selectedIds.includes(m.id);
            return (
              <div
                key={m.id}
                className={`model-row${sel ? ' sel' : ''}${hoverId === m.id ? ' hover' : ''}`}
                onMouseEnter={() => setHover(m.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => toggleSelected(m.id)}
                onDoubleClick={() => setDetail(m.id)}
                title="单击加入对比 · 双击查看详情"
              >
                <div className="tick">{sel ? '✓' : ''}</div>
                <div className="nm">
                  <div className="n1">{m.shortName}</div>
                  <div className="n2">
                    <span style={{ color: m.creator.color }}>{m.creator.name}</span>
                    {m.releaseDate ? ` · ${m.releaseDate}` : ''}
                  </div>
                </div>
                <div className="val">
                  {formatMetricValue(sortKey, getMetric(m, sortKey))}
                  <small>{METRIC_MAP[sortKey]?.label ?? sortKey}</small>
                </div>
              </div>
            );
          })}
          {!rows.length ? <div className="empty">没有符合筛选条件的模型</div> : null}
        </div>
      </div>

      <div className="section" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
        <button
          className="btn"
          style={{ width: '100%' }}
          disabled={status === 'loading'}
          onClick={() => loadDataset(true)}
        >
          {status === 'loading' ? '抓取中…' : '刷新源站数据'}
        </button>
      </div>
    </aside>
  );
}
