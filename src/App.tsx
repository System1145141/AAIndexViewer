import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { applyFilters, LIVE_REFRESH, useStore } from './store';
import { METRICS, METRIC_MAP, formatMetricValue } from './metrics';
import { RAMP_CSS } from './ramp';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import { Chart2D, type Chart2DHandle } from './components/Chart2D';
import type { Scene3DHandle } from './components/Scene3D';
import CompareDock from './components/CompareDock';
import ModelDetail from './components/ModelDetail';
import { exportModelsCSV, timestamp, withWatermark, downloadDataURL } from './utils/exporters';

/** three.js 体积较大，仅在切换到三维场景时按需加载 */
const Scene3D = lazy(() =>
  import('./components/Scene3D').then((m) => ({ default: m.Scene3D })),
);

export default function App() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const dataset = useStore((s) => s.dataset);
  const origin = useStore((s) => s.origin);
  const loadDataset = useStore((s) => s.loadDataset);
  const filters = useStore((s) => s.filters);
  const mode = useStore((s) => s.mode);
  const detailId = useStore((s) => s.detailId);
  const setDetail = useStore((s) => s.setDetail);
  const hoverId = useStore((s) => s.hoverId);
  const setHover = useStore((s) => s.setHover);
  const selectedIds = useStore((s) => s.selectedIds);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const compareOpen = useStore((s) => s.compareOpen);
  const toast = useStore((s) => s.toast);
  const showToast = useStore((s) => s.showToast);
  const colorKey = useStore((s) => s.colorKey);
  const colorMode = useStore((s) => s.colorMode);
  const chart = useStore((s) => s.chart);
  const xKey = useStore((s) => s.xKey);
  const yKey = useStore((s) => s.yKey);
  const zKey = useStore((s) => s.zKey);
  const sizeKey = useStore((s) => s.sizeKey);
  const radarKeys = useStore((s) => s.radarKeys);
  const xScale = useStore((s) => s.xScale);
  const yScale = useStore((s) => s.yScale);
  const topN = useStore((s) => s.topN);
  const showLabels = useStore((s) => s.showLabels);
  const showPareto = useStore((s) => s.showPareto);

  const chartRef = useRef<Chart2DHandle>(null);
  const sceneRef = useRef<Scene3DHandle>(null);

  useEffect(() => {
    void loadDataset();
  }, [loadDataset]);

  // 深链：#detail=<slug> 直接打开模型详情面板
  useEffect(() => {
    const slug = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('detail');
    if (!slug) return;
    const off = useStore.subscribe((s) => {
      const m = s.dataset?.models.find((x) => x.slug === slug);
      if (m) {
        useStore.getState().setDetail(m.id);
        off();
      }
    });
    return off;
  }, []);

  useEffect(() => {
    if (!detailId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailId, setDetail]);

  const visibleModels = useMemo(
    () => (dataset ? applyFilters(dataset.models, filters) : []),
    [dataset, filters],
  );

  const detailModel = useMemo(
    () => (detailId ? dataset?.models.find((m) => m.id === detailId) ?? null : null),
    [detailId, dataset],
  );

  const selectedModels = useMemo(() => {
    const set = new Set(selectedIds);
    return dataset?.models.filter((m) => set.has(m.id)) ?? [];
  }, [selectedIds, dataset]);

  const handleExportPNG = async () => {
    const url = mode === '2d' ? chartRef.current?.getDataURL() : sceneRef.current?.getDataURL();
    if (!url) {
      showToast('当前视图暂不支持导出');
      return;
    }
    const caption = `${dataset?.indexVersion ?? ''} · ${
      mode === '2d' ? '二维图表' : '三维场景'
    } · ${visibleModels.length} 个模型 · 数据源 Artificial Analysis`;
    downloadDataURL(await withWatermark(url, caption), `aa-chart-${timestamp()}.png`);
    showToast('图片已导出');
  };

  const handleExportCSV = () => {
    if (!visibleModels.length) {
      showToast('没有可导出的数据');
      return;
    }
    exportModelsCSV(
      visibleModels,
      METRICS.map((m) => m.key),
      `aa-models-${timestamp()}.csv`,
    );
    showToast(`已导出 ${visibleModels.length} 个模型 · ${METRICS.length} 项指标`);
  };

  const fetched = dataset ? new Date(dataset.fetchedAt) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">AA</div>
          <div>
            <div className="brand-title">智能指数可视化探索器</div>
            <div className="brand-sub">Artificial Analysis Intelligence Index</div>
          </div>
        </div>

        {dataset ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge">{dataset.indexVersion}</span>
            <span className="badge">{dataset.count} 个模型</span>
            <span className={`badge ${origin === 'network' ? 'live' : 'cache'}`}>
              {origin === 'network' ? '实时抓取' : origin === 'bundled' ? '内置快照' : '本地缓存'}
            </span>
            {fetched ? (
              <span className="badge">更新于 {fetched.toLocaleString('zh-CN', { hour12: false })}</span>
            ) : null}
            <span className="badge">当前视图 {visibleModels.length} 个</span>
          </div>
        ) : null}

        <div className="topbar-spacer" />

        <a
          className="btn"
          href={dataset?.sourceUrl ?? 'https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index'}
          target="_blank"
          rel="noreferrer"
        >
          数据源 ↗
        </a>
        {/* 纯静态部署下没有服务端接口，按钮只会重新读一遍快照，直接隐藏 */}
        {LIVE_REFRESH ? (
          <button className="btn primary" onClick={() => loadDataset(true)} disabled={status === 'loading'}>
            {status === 'loading' ? '抓取中…' : '刷新数据'}
          </button>
        ) : null}
      </header>

      <div className="body">
        <Sidebar visibleModels={visibleModels} />

        <main className="main">
          <Toolbar
            onExportPNG={handleExportPNG}
            onExportCSV={handleExportCSV}
            onResetView={() => sceneRef.current?.resetView()}
          />

          <div className="chart-host">
            {status === 'error' ? (
              <div className="center-state">
                <div style={{ maxWidth: 460 }}>
                  <div style={{ fontSize: 34, marginBottom: 10 }}>⚠</div>
                  <div style={{ marginBottom: 14 }}>{error}</div>
                  <button className="btn primary" onClick={() => loadDataset(true)}>
                    重试
                  </button>
                </div>
              </div>
            ) : status !== 'ready' || !dataset ? (
              <div className="center-state">
                <div>
                  <div className="spinner" />
                  正在加载 Artificial Analysis 评测数据…
                </div>
              </div>
            ) : mode === '2d' ? (
              <Chart2D
                ref={chartRef}
                models={visibleModels}
                chart={chart}
                xKey={xKey}
                yKey={yKey}
                sizeKey={sizeKey}
                radarKeys={radarKeys}
                xScale={xScale}
                yScale={yScale}
                topN={topN}
                showPareto={showPareto}
                selectedIds={selectedIds}
                hoverId={hoverId}
                onHover={setHover}
                onPick={toggleSelected}
                onOpen={setDetail}
              />
            ) : (
              <Suspense
                fallback={
                  <div className="center-state">
                    <div>
                      <div className="spinner" />
                      正在加载三维引擎…
                    </div>
                  </div>
                }
              >
                <Scene3D
                  ref={sceneRef}
                  models={visibleModels}
                  xKey={xKey}
                  yKey={yKey}
                  zKey={zKey}
                  sizeKey={sizeKey}
                  colorKey={colorKey}
                  colorMode={colorMode}
                  selectedIds={selectedIds}
                  showLabels={showLabels}
                  hoverId={hoverId}
                  onHover={setHover}
                  onPick={toggleSelected}
                  onOpen={setDetail}
                />
                <div className="scene-overlay">
                  <div className="scene-hint">
                    左键拖拽旋转 · 滚轮缩放 · 右键平移 · 点击节点加入对比 · Shift+点击查看详情
                  </div>
                  {colorMode === 'metric' ? (
                    <div className="scene-legend">
                      <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                        颜色 · {METRIC_MAP[colorKey]?.label ?? colorKey}
                      </div>
                      <div className="gradient-bar" style={{ background: RAMP_CSS }} />
                      <div className="scale-labels">
                        <span>低</span>
                        <span>高</span>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-mute)' }}>
                        大小 · {METRIC_MAP[sizeKey]?.label ?? sizeKey}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12 }}>
                        {hoverId
                          ? (() => {
                              const m = visibleModels.find((x) => x.id === hoverId);
                              return m ? (
                                <>
                                  <div style={{ color: '#e8ecf5' }}>{m.shortName}</div>
                                  <div style={{ color: 'var(--text-mute)' }}>
                                    {METRIC_MAP[colorKey]?.label}: {formatMetricValue(colorKey, m.metrics[colorKey])}
                                  </div>
                                </>
                              ) : null;
                            })()
                          : `悬停节点查看数据（${visibleModels.length} 个节点）`}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Suspense>
            )}
          </div>

          {compareOpen && selectedModels.length ? <CompareDock /> : null}

          {!visibleModels.length && status === 'ready' ? (
            <div className="center-state" style={{ pointerEvents: 'none' }}>
              <div>没有符合当前筛选条件的模型，请调整筛选条件。</div>
            </div>
          ) : null}
        </main>
      </div>

      {detailModel ? <ModelDetail model={detailModel} onClose={() => setDetail(null)} /> : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
