import { create } from 'zustand';
import type { AxisScale, ChartKind, Dataset, Filters, SortDir, ViewMode } from './types';
import { getMetric, METRIC_MAP } from './metrics';
import type { ColorMode } from './components/Scene3D';

const DATASET_KEY = 'aa-explorer:dataset:v2';
/** v2：默认 X 轴改为全量覆盖指标，旧偏好不迁移 */
const PREFS_KEY = 'aa-explorer:prefs:v2';
/** 缓存有效期：6 小时 */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 是否启用服务端实时抓取（`/api/aa/refresh`）。
 * 纯静态部署（GitHub Actions 定时生成快照 + Cloudflare 静态资源）下以
 * `VITE_ENABLE_REFRESH=false` 构建来关闭，避免每次加载都去请求一个并不存在的接口。
 * 本地 `npm run dev` 保留服务端接口，行为不变。
 */
export const LIVE_REFRESH = import.meta.env.VITE_ENABLE_REFRESH !== 'false';

export interface Prefs {
  mode: ViewMode;
  chart: ChartKind;
  xKey: string;
  yKey: string;
  zKey: string;
  sizeKey: string;
  colorKey: string;
  colorMode: ColorMode;
  showLabels: boolean;
  /** 散点图是否绘制帕累托前沿连线与最优区间 */
  showPareto: boolean;
  xScale: AxisScale;
  yScale: AxisScale;
  radarKeys: string[];
  topN: number;
  sortKey: string;
  sortDir: SortDir;
  filters: Filters;
  selectedIds: string[];
}

const DEFAULT_FILTERS: Filters = {
  search: '',
  creators: [],
  openWeightsOnly: false,
  reasoningOnly: false,
  hideDeprecated: true,
  requireCost: false,
  requireSpeed: false,
  minIndex: 0,
};

const DEFAULT_PREFS: Prefs = {
  mode: '2d',
  chart: 'scatter',
  // 默认 X 轴选用全量覆盖的指标，避免因价格数据缺失而隐藏大部分模型
  xKey: 'outputTokensPerTask',
  yKey: 'intelligenceIndex',
  zKey: 'outputTokensPerTask',
  sizeKey: 'intelligenceIndex',
  colorKey: 'intelligenceIndex',
  colorMode: 'metric',
  showLabels: false,
  showPareto: true,
  xScale: 'log',
  yScale: 'linear',
  radarKeys: [
    'gdpval',
    'tauBanking',
    'terminalbenchV21',
    'scicode',
    'hle',
    'gpqa',
    'critpt',
    'omniscience',
    'lcr',
  ],
  topN: 15,
  sortKey: 'intelligenceIndex',
  sortDir: 'desc',
  filters: DEFAULT_FILTERS,
  selectedIds: [],
};

interface AppState extends Prefs {
  dataset: Dataset | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** 数据来源：缓存 / 网络 / 内置快照 */
  origin: 'cache' | 'network' | 'bundled' | null;
  detailId: string | null;
  hoverId: string | null;
  compareOpen: boolean;
  toast: string | null;

  loadDataset: (force?: boolean) => Promise<void>;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  clearSelected: () => void;
  setDetail: (id: string | null) => void;
  setHover: (id: string | null) => void;
  setCompareOpen: (open: boolean) => void;
  showToast: (msg: string | null) => void;
}

function readCache(): Dataset | null {
  try {
    const raw = localStorage.getItem(DATASET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; data: Dataset };
    if (!parsed?.data?.models?.length) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: Dataset) {
  try {
    localStorage.setItem(DATASET_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    /* 配额不足时静默降级 */
  }
}

function cacheAge(data: Dataset | null): number {
  if (!data?.fetchedAt) return Infinity;
  const t = Date.parse(data.fetchedAt);
  return Number.isFinite(t) ? Date.now() - t : Infinity;
}

function readPrefs(): Prefs {
  let prefs = DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      prefs = {
        ...DEFAULT_PREFS,
        ...parsed,
        filters: { ...DEFAULT_FILTERS, ...(parsed.filters || {}) },
      };
    }
  } catch {
    prefs = DEFAULT_PREFS;
  }
  // 支持 URL 深链：#mode=3d&chart=radar&x=costPerTask&y=intelligenceIndex
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const mode = hash.get('mode');
    if (mode === '3d' || mode === '2d') {
      // 三维需要三个互不相同的轴，避免节点坍缩
      if (mode === '3d' && prefs.zKey === prefs.xKey) {
        const alt = ['costPerTask', 'outputSpeed', 'timePerTask', 'hle', 'gpqa'].find(
          (k) => k !== prefs.xKey && k !== prefs.yKey,
        );
        if (alt) prefs = { ...prefs, zKey: alt };
      }
      prefs = { ...prefs, mode };
    }
    const chart = hash.get('chart');
    if (chart === 'scatter' || chart === 'bar' || chart === 'radar') {
      prefs = { ...prefs, chart, mode: '2d' };
    }
    const metric = (name: string | null): string | null =>
      name && METRIC_MAP[name] ? name : null;
    const x = metric(hash.get('x'));
    if (x) prefs = { ...prefs, xKey: x };
    const y = metric(hash.get('y'));
    if (y) prefs = { ...prefs, yKey: y };
    const z = metric(hash.get('z'));
    if (z) prefs = { ...prefs, zKey: z };
    const size = metric(hash.get('size'));
    if (size) prefs = { ...prefs, sizeKey: size };
  } catch {
    /* ignore */
  }
  return prefs;
}

function writePrefs(state: AppState) {
  try {
    const prefs: Prefs = {
      mode: state.mode,
      chart: state.chart,
      xKey: state.xKey,
      yKey: state.yKey,
      zKey: state.zKey,
      sizeKey: state.sizeKey,
      colorKey: state.colorKey,
      colorMode: state.colorMode,
      showLabels: state.showLabels,
      showPareto: state.showPareto,
      xScale: state.xScale,
      yScale: state.yScale,
      radarKeys: state.radarKeys,
      topN: state.topN,
      sortKey: state.sortKey,
      sortDir: state.sortDir,
      filters: state.filters,
      selectedIds: state.selectedIds,
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export const useStore = create<AppState>((set, get) => ({
  ...readPrefs(),
  dataset: null,
  status: 'idle',
  error: null,
  origin: null,
  detailId: null,
  hoverId: null,
  compareOpen: false,
  toast: null,

  loadDataset: async (force = false) => {
    const cached = readCache();
    const bundledUrl = `${import.meta.env.BASE_URL}data/aa-intelligence-index.json`;

    if (!force && cached && cacheAge(cached) < CACHE_TTL_MS) {
      set({ dataset: cached, status: 'ready', error: null, origin: 'cache' });
      return;
    }

    set({ status: 'loading', error: null });

    // 优先使用内置的快照数据（离线可用），再尝试通过网络刷新
    let bundled: Dataset | null = null;
    try {
      const res = await fetch(bundledUrl, { cache: 'no-cache' });
      if (res.ok) bundled = (await res.json()) as Dataset;
    } catch {
      /* ignore */
    }

    // 纯静态部署没有服务端接口，直接落到快照 / 本地缓存上
    if (!LIVE_REFRESH) {
      if (bundled) {
        writeCache(bundled);
        set({ dataset: bundled, status: 'ready', origin: 'bundled', error: null });
        return;
      }
      if (cached) {
        set({ dataset: cached, status: 'ready', origin: 'cache', error: null });
        return;
      }
      set({
        status: 'error',
        error: '未找到内置数据快照，请先执行 npm run fetch:data 生成数据文件。',
      });
      return;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      const res = await fetch('/api/aa/refresh', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`刷新接口返回 HTTP ${res.status}`);
      const data = (await res.json()) as Dataset;
      if (!data?.models?.length) throw new Error('返回数据为空');
      writeCache(data);
      set({ dataset: data, status: 'ready', error: null, origin: 'network' });
      get().showToast(`已更新 ${data.count} 个模型（${data.indexVersion}）`);
      return;
    } catch (err) {
      if (bundled) {
        writeCache(bundled);
        set({ dataset: bundled, status: 'ready', origin: 'bundled', error: null });
        if (force) {
          get().showToast(`实时抓取失败，已回退到内置快照：${(err as Error).message}`);
        }
        return;
      }
      if (cached) {
        set({ dataset: cached, status: 'ready', origin: 'cache', error: null });
        if (force) get().showToast(`实时抓取失败，使用本地缓存：${(err as Error).message}`);
        return;
      }
      set({
        status: 'error',
        error: `无法加载数据：${(err as Error).message}。可执行 npm run fetch:data 生成内置快照。`,
      });
    }
  },

  setPref: (key, value) => {
    set({ [key]: value } as Partial<AppState>);
    writePrefs(get());
  },

  setFilter: (key, value) => {
    set({ filters: { ...get().filters, [key]: value } });
    writePrefs(get());
  },

  resetFilters: () => {
    set({ filters: DEFAULT_FILTERS });
    writePrefs(get());
  },

  toggleSelected: (id) => {
    const cur = get().selectedIds;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    set({ selectedIds: next, compareOpen: next.length > 0 ? true : get().compareOpen });
    writePrefs(get());
  },

  setSelected: (ids) => {
    set({ selectedIds: ids });
    writePrefs(get());
  },

  clearSelected: () => {
    set({ selectedIds: [], compareOpen: false });
    writePrefs(get());
  },

  setDetail: (id) => set({ detailId: id }),
  setHover: (id) => set({ hoverId: id }),
  setCompareOpen: (open) => set({ compareOpen: open }),
  showToast: (msg) => {
    set({ toast: msg });
    if (msg) setTimeout(() => set((s) => (s.toast === msg ? { toast: null } : s)), 4000);
  },
}));

/** 应用筛选条件 */
export function applyFilters(models: Dataset['models'], filters: Filters) {
  const q = filters.search.trim().toLowerCase();
  return models.filter((m) => {
    if (filters.hideDeprecated && m.deprecated) return false;
    if (filters.openWeightsOnly && !m.isOpenWeights) return false;
    if (filters.reasoningOnly && !m.isReasoning) return false;
    if (filters.requireCost && getMetric(m, 'costPerTask') == null) return false;
    if (filters.requireSpeed && getMetric(m, 'outputSpeed') == null) return false;
    if (filters.creators.length && !filters.creators.includes(m.creator.slug)) return false;
    if (filters.minIndex > 0 && (m.metrics.intelligenceIndex ?? 0) < filters.minIndex) return false;
    if (q) {
      const hay = `${m.name} ${m.shortName} ${m.creator.name} ${m.slug}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** 应用排序（空值恒排末尾） */
export function applySort(models: Dataset['models'], key: string, dir: SortDir) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...models].sort((a, b) => {
    const av = getMetric(a, key);
    const bv = getMetric(b, key);
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * sign;
  });
}
