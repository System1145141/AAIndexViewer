import { useStore } from '../store';
import { METRICS, METRIC_GROUPS, METRIC_MAP } from '../metrics';
import type { AxisScale } from '../types';

function MetricSelect({
  value,
  onChange,
  exclude,
  width = 190,
}: {
  value: string;
  onChange: (v: string) => void;
  exclude?: string[];
  width?: number;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width }}>
      {METRIC_GROUPS.map((g) => {
        const items = METRICS.filter((m) => m.group === g && !exclude?.includes(m.key));
        if (!items.length) return null;
        return (
          <optgroup key={g} label={g}>
            {items.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function ScaleToggle({
  value,
  onChange,
  disabledLog,
}: {
  value: AxisScale;
  onChange: (v: AxisScale) => void;
  disabledLog?: boolean;
}) {
  return (
    <div className="seg">
      <button className={value === 'linear' ? 'on' : ''} onClick={() => onChange('linear')}>
        线性
      </button>
      <button
        className={value === 'log' ? 'on' : ''}
        disabled={disabledLog}
        title={disabledLog ? '该指标含零值，不适用对数坐标' : ''}
        style={disabledLog ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        onClick={() => !disabledLog && onChange('log')}
      >
        对数
      </button>
    </div>
  );
}

export default function Toolbar({
  onExportPNG,
  onExportCSV,
  onResetView,
}: {
  onExportPNG: () => void;
  onExportCSV: () => void;
  onResetView: () => void;
}) {
  const mode = useStore((s) => s.mode);
  const chart = useStore((s) => s.chart);
  const xKey = useStore((s) => s.xKey);
  const yKey = useStore((s) => s.yKey);
  const zKey = useStore((s) => s.zKey);
  const sizeKey = useStore((s) => s.sizeKey);
  const colorKey = useStore((s) => s.colorKey);
  const colorMode = useStore((s) => s.colorMode);
  const xScale = useStore((s) => s.xScale);
  const yScale = useStore((s) => s.yScale);
  const radarKeys = useStore((s) => s.radarKeys);
  const topN = useStore((s) => s.topN);
  const showLabels = useStore((s) => s.showLabels);
  const showPareto = useStore((s) => s.showPareto);
  const setPref = useStore((s) => s.setPref);

  const logOk = (k: string) => METRIC_MAP[k]?.logSafe ?? true;

  return (
    <div className="chart-toolbar">
      <div className="field">
        <label>视图模式</label>
        <div className="seg">
          <button className={mode === '2d' ? 'on' : ''} onClick={() => setPref('mode', '2d')}>
            二维图表
          </button>
          <button
            className={mode === '3d' ? 'on' : ''}
            onClick={() => {
              setPref('mode', '3d');
              // 三维需要三个不同的轴，避免退化成平面/直线
              const s = useStore.getState();
              if (s.zKey === s.xKey) {
                const preferred = ['costPerTask', 'outputTokensPerTask', 'outputSpeed', 'timePerTask', 'hle', 'gpqa'];
                const alt = preferred.find((k) => k !== s.xKey && k !== s.yKey);
                if (alt) setPref('zKey', alt);
              }
            }}
          >
            三维场景
          </button>
        </div>
      </div>

      {mode === '2d' ? (
        <>
          <div className="field">
            <label>图表类型</label>
            <div className="seg">
              <button className={chart === 'scatter' ? 'on' : ''} onClick={() => setPref('chart', 'scatter')}>
                散点图
              </button>
              <button className={chart === 'bar' ? 'on' : ''} onClick={() => setPref('chart', 'bar')}>
                柱状图
              </button>
              <button className={chart === 'radar' ? 'on' : ''} onClick={() => setPref('chart', 'radar')}>
                雷达图
              </button>
            </div>
          </div>

          {chart === 'radar' ? (
            <div className="field" style={{ maxWidth: 460 }}>
              <label>
                雷达维度 · {radarKeys.length} 项（点选指标，建议 4–9 项）
              </label>
              <div className="chips" style={{ maxHeight: 62, overflowY: 'auto' }}>
                {METRICS.filter((m) => m.key !== 'releaseTs').map((m) => {
                  const on = radarKeys.includes(m.key);
                  return (
                    <button
                      key={m.key}
                      className={`chip${on ? ' on' : ''}`}
                      onClick={() =>
                        setPref(
                          'radarKeys',
                          on ? radarKeys.filter((k) => k !== m.key) : [...radarKeys, m.key],
                        )
                      }
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {chart === 'scatter' ? (
                <>
                  <div className="field">
                    <label>X 轴指标</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <MetricSelect value={xKey} onChange={(v) => setPref('xKey', v)} />
                      <ScaleToggle
                        value={xScale}
                        onChange={(v) => setPref('xScale', v)}
                        disabledLog={!logOk(xKey)}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label>Y 轴指标</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <MetricSelect value={yKey} onChange={(v) => setPref('yKey', v)} />
                      <ScaleToggle
                        value={yScale}
                        onChange={(v) => setPref('yScale', v)}
                        disabledLog={!logOk(yKey)}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label>气泡大小</label>
                    <MetricSelect value={sizeKey} onChange={(v) => setPref('sizeKey', v)} width={150} />
                  </div>
                  <div className="field">
                    <label>最优前沿</label>
                    <label className="check" title="按两轴指标方向（越大越好 / 越小越好）计算帕累托非支配解并连线">
                      <input
                        type="checkbox"
                        checked={showPareto}
                        onChange={(e) => setPref('showPareto', e.target.checked)}
                      />
                      Pareto 连线
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label>Y 轴指标</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <MetricSelect value={yKey} onChange={(v) => setPref('yKey', v)} />
                      <ScaleToggle
                        value={yScale}
                        onChange={(v) => setPref('yScale', v)}
                        disabledLog={!logOk(yKey)}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label>显示数量 Top N · {topN}</label>
                    <input
                      type="range"
                      min={5}
                      max={40}
                      step={1}
                      value={topN}
                      onChange={(e) => setPref('topN', Number(e.target.value))}
                      style={{ width: 150 }}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="field">
            <label>X 轴</label>
            <MetricSelect value={xKey} onChange={(v) => setPref('xKey', v)} width={160} />
          </div>
          <div className="field">
            <label>Y 轴</label>
            <MetricSelect value={yKey} onChange={(v) => setPref('yKey', v)} width={160} />
          </div>
          <div className="field">
            <label>Z 轴</label>
            <MetricSelect value={zKey} onChange={(v) => setPref('zKey', v)} width={160} />
          </div>
          <div className="field">
            <label>节点大小</label>
            <MetricSelect value={sizeKey} onChange={(v) => setPref('sizeKey', v)} width={160} />
          </div>
          <div className="field">
            <label>节点颜色</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <div className="seg">
                <button
                  className={colorMode === 'metric' ? 'on' : ''}
                  onClick={() => setPref('colorMode', 'metric')}
                >
                  指标
                </button>
                <button
                  className={colorMode === 'creator' ? 'on' : ''}
                  onClick={() => setPref('colorMode', 'creator')}
                >
                  厂商
                </button>
              </div>
              {colorMode === 'metric' ? (
                <MetricSelect value={colorKey} onChange={(v) => setPref('colorKey', v)} width={150} />
              ) : null}
            </div>
          </div>
          <div className="field">
            <label>显示</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setPref('showLabels', e.target.checked)}
                />
                节点标签
              </label>
              <button className="btn sm" onClick={onResetView}>
                复位视角
              </button>
            </div>
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />

      <div className="field">
        <label>导出</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm" onClick={onExportPNG}>
            PNG 图片
          </button>
          <button className="btn sm" onClick={onExportCSV}>
            CSV 数据
          </button>
        </div>
      </div>
    </div>
  );
}
