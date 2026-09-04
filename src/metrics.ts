import type { MetricValue, Model } from './types';

export type MetricScale = 'index' | 'ratio' | 'elo' | 'tokens' | 'usd' | 'minutes' | 'tps' | 'price' | 'date';

export type MetricGroup = '综合指数' | '分项评测' | 'Token 用量' | '成本' | '速度与耗时' | '价格' | '其他指标';

export interface MetricDef {
  key: string;
  label: string;
  group: MetricGroup;
  scale: MetricScale;
  /** high = 越大越好；low = 越小越好；none = 无方向 */
  better: 'high' | 'low' | 'none';
  /** 是否适合作为对数坐标轴（要求取值恒为正） */
  logSafe: boolean;
  /** 数值说明，用于 tooltip */
  hint?: string;
}

export const METRICS: MetricDef[] = [
  { key: 'intelligenceIndex', label: '智能指数', group: '综合指数', scale: 'index', better: 'high', logSafe: true, hint: '九项评测加权综合分（0-100）' },

  { key: 'gdpval', label: 'GDPval-AA v2 (Elo)', group: '分项评测', scale: 'elo', better: 'high', logSafe: false, hint: '真实职业任务 Elo（低分模型可能为负）' },
  { key: 'tauBanking', label: '𝜏³-Banking', group: '分项评测', scale: 'ratio', better: 'high', logSafe: false, hint: '金融客服 Agent 任务完成率' },
  { key: 'terminalbenchV21', label: 'Terminal-Bench v2.1', group: '分项评测', scale: 'ratio', better: 'high', logSafe: false, hint: '终端环境任务完成率' },
  { key: 'scicode', label: 'SciCode', group: '分项评测', scale: 'ratio', better: 'high', logSafe: false, hint: '科研编程准确率' },
  { key: 'hle', label: "Humanity's Last Exam", group: '分项评测', scale: 'ratio', better: 'high', logSafe: false, hint: '人类最后考试准确率' },
  { key: 'gpqa', label: 'GPQA Diamond', group: '分项评测', scale: 'ratio', better: 'high', logSafe: false, hint: '博士级科学问答准确率' },
  { key: 'critpt', label: 'CritPt', group: '分项评测', scale: 'ratio', better: 'high', logSafe: false, hint: '研究级物理推理' },
  { key: 'omniscience', label: 'AA-Omniscience', group: '分项评测', scale: 'index', better: 'high', logSafe: false, hint: '知识广度与幻觉抑制综合分（可为负）' },
  { key: 'lcr', label: 'AA-LCR', group: '分项评测', scale: 'ratio', better: 'high', logSafe: false, hint: '长上下文推理准确率' },

  { key: 'outputTokensPerTask', label: '每任务输出 Token', group: 'Token 用量', scale: 'tokens', better: 'low', logSafe: true, hint: '推理 + 回答 Token 加权均值' },
  { key: 'reasoningTokensPerTask', label: '每任务推理 Token', group: 'Token 用量', scale: 'tokens', better: 'low', logSafe: true, hint: '思考链 Token 加权均值' },
  { key: 'answerTokensPerTask', label: '每任务回答 Token', group: 'Token 用量', scale: 'tokens', better: 'low', logSafe: true, hint: '最终回答 Token 加权均值' },
  { key: 'inputTokensPerTask', label: '每任务输入 Token', group: 'Token 用量', scale: 'tokens', better: 'low', logSafe: true, hint: '输入上下文 Token 加权均值' },

  { key: 'costPerTask', label: '每任务花费', group: '成本', scale: 'usd', better: 'low', logSafe: true, hint: '按评测权重加权的单任务成本' },
  { key: 'totalCost', label: '全量评测总花费', group: '成本', scale: 'usd', better: 'low', logSafe: true, hint: '跑完整个指数套件的总成本' },

  { key: 'outputSpeed', label: '推理速度', group: '速度与耗时', scale: 'tps', better: 'high', logSafe: true, hint: '中位输出速度（Token/秒）' },
  { key: 'timePerTask', label: '每任务耗时', group: '速度与耗时', scale: 'minutes', better: 'low', logSafe: true, hint: '加权解码时间（分钟）' },

  { key: 'price1mInputTokens', label: '输入价格', group: '价格', scale: 'price', better: 'low', logSafe: true, hint: '每百万输入 Token 美元价' },
  { key: 'price1mOutputTokens', label: '输出价格', group: '价格', scale: 'price', better: 'low', logSafe: true, hint: '每百万输出 Token 美元价' },

  { key: 'briefcaseElo', label: 'AA-Briefcase (Elo)', group: '其他指标', scale: 'elo', better: 'high', logSafe: false, hint: '知识工作流 Agent Elo（低分模型可能为负）' },
  { key: 'harveyLab', label: 'Harvey LAB-AA', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '法律 Agent 标准通过率' },
  { key: 'mmmuPro', label: 'MMMU-Pro', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '多模态学科理解' },
  { key: 'mlcrOverall', label: 'MLCR-AA', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '医疗长上下文推理' },
  { key: 'opennessIndex', label: '开放指数', group: '其他指标', scale: 'index', better: 'high', logSafe: false, hint: '模型开放程度综合分' },
  { key: 'ifbench', label: 'IFBench', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '指令遵循泛化' },
  { key: 'tau2', label: '𝜏²-Bench Telecom', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '电信客服双控对话' },
  { key: 'terminalbenchHard', label: 'Terminal-Bench Hard', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '高难度终端任务' },
  { key: 'mmluPro', label: 'MMLU-Pro', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '研究生级学科问答' },
  { key: 'livecodebench', label: 'LiveCodeBench', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '无污染竞赛编程' },
  { key: 'aime25', label: 'AIME 2025', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '奥数邀请赛' },
  { key: 'math500', label: 'MATH-500', group: '其他指标', scale: 'ratio', better: 'high', logSafe: false, hint: '竞赛数学' },
  { key: 'releaseTs', label: '发布日期', group: '其他指标', scale: 'date', better: 'none', logSafe: true, hint: '模型发布时间戳' },
];

export const METRIC_MAP: Record<string, MetricDef> = Object.fromEntries(
  METRICS.map((m) => [m.key, m]),
);

export const METRIC_GROUPS: MetricGroup[] = [
  '综合指数',
  '分项评测',
  'Token 用量',
  '成本',
  '速度与耗时',
  '价格',
  '其他指标',
];

export function getMetric(model: Model, key: string): MetricValue {
  const v = model.metrics[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 紧凑数字：12.3k / 4.5M */
export function compactNumber(v: number, digits = 1): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(digits)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(digits)}k`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(digits)}k`;
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export function formatMetricValue(key: string, value: MetricValue): string {
  if (value == null) return '—';
  const def = METRIC_MAP[key];
  if (!def) return String(value);
  switch (def.scale) {
    case 'ratio':
      return `${(value * 100).toFixed(1)}%`;
    case 'index':
      return value.toFixed(1);
    case 'elo':
      return value.toFixed(0);
    case 'tokens':
      return compactNumber(value, 1);
    case 'usd':
      return value >= 100 ? `$${value.toFixed(0)}` : value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`;
    case 'minutes':
      return value >= 60 ? `${(value / 60).toFixed(1)} h` : `${value.toFixed(1)} min`;
    case 'tps':
      return `${value.toFixed(1)} tok/s`;
    case 'price':
      return `$${value.toFixed(2)}/M`;
    case 'date':
      return new Date(value).toISOString().slice(0, 10);
    default:
      return String(value);
  }
}

/** 坐标轴刻度用的简短格式化 */
export function formatAxis(key: string, value: number): string {
  const def = METRIC_MAP[key];
  if (!def) return String(value);
  switch (def.scale) {
    case 'ratio':
      return `${(value * 100).toFixed(0)}%`;
    case 'usd':
      return `$${value >= 10 ? value.toFixed(0) : value.toFixed(2)}`;
    case 'tokens':
      return compactNumber(value, 0);
    case 'tps':
      return value.toFixed(0);
    case 'minutes':
      return value.toFixed(0);
    case 'date':
      return new Date(value).toISOString().slice(2, 7);
    default:
      return value >= 100 ? value.toFixed(0) : value.toFixed(1);
  }
}

/** 换算到绘图坐标系的数值（比率类放大 100 倍，便于对数轴与阅读） */
export function plotValue(key: string, value: number | null): number | null {
  if (value == null) return null;
  const def = METRIC_MAP[key];
  if (def?.scale === 'ratio') return value * 100;
  return value;
}

/** 绘图坐标下的单位后缀 */
export function plotUnit(key: string): string {
  const def = METRIC_MAP[key];
  if (!def) return '';
  switch (def.scale) {
    case 'ratio':
      return '%';
    case 'usd':
      return 'USD';
    case 'tokens':
      return 'tokens/task';
    case 'minutes':
      return 'min';
    case 'tps':
      return 'tok/s';
    case 'price':
      return 'USD/1M';
    case 'elo':
      return 'Elo';
    case 'date':
      return '';
    default:
      return '';
  }
}

export function metricUnit(key: string): string {
  const def = METRIC_MAP[key];
  if (!def) return '';
  switch (def.scale) {
    case 'ratio':
      return '%';
    case 'usd':
      return 'USD';
    case 'tokens':
      return 'tokens/task';
    case 'minutes':
      return 'min';
    case 'tps':
      return 'tok/s';
    case 'price':
      return 'USD / 1M';
    case 'elo':
      return 'Elo';
    default:
      return '';
  }
}

/** 把指标值转换成"越大越优"的分数，用于帕累托前沿计算；无方向指标（如发布日期）返回 null */
export function betterScore(key: string, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const def = METRIC_MAP[key];
  if (!def || def.better === 'none') return null;
  return def.better === 'low' ? -value : value;
}

/** 把任意指标归一到 0..1（越大越好），用于雷达图与 3D 节点映射。 */
export function normalizeForDisplay(models: Model[], key: string): Map<string, number> {
  const map = new Map<string, number>();
  const def = METRIC_MAP[key];
  const values: number[] = [];
  for (const m of models) {
    const v = getMetric(m, key);
    if (v != null) values.push(v);
  }
  if (!values.length) return map;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  for (const m of models) {
    const v = getMetric(m, key);
    if (v == null) continue;
    let n = (v - min) / (max - min);
    if (def?.better === 'low') n = 1 - n;
    map.set(m.id, Math.min(1, Math.max(0, n)));
  }
  return map;
}
