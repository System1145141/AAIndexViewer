export interface EvalMeta {
  key: string;
  label: string;
  taskCount: number;
  weight: number;
}

export interface Creator {
  id: string | null;
  slug: string;
  name: string;
  color: string;
  logo: string | null;
}

export interface UsagePerEval {
  key: string;
  label: string;
  taskCount: number;
  weight: number;
  inputTokens: number;
  reasoningTokens: number;
  answerTokens: number;
  fullCost: number | null;
}

export interface ModelUsage {
  inputTokensPerTask: number | null;
  outputTokensPerTask: number | null;
  reasoningTokensPerTask: number | null;
  answerTokensPerTask: number | null;
  perEval: UsagePerEval[];
}

export interface ModelCost {
  costPerTask: number | null;
  totalCost: number | null;
  breakdownPerTask: {
    input: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    answer: number;
  } | null;
}

export interface ModelSpeed {
  outputSpeed: number | null;
  timePerTask: number | null;
}

export interface ModelPricing {
  price1mInputTokens: number | null;
  price1mOutputTokens: number | null;
  cacheHitPrice: number | null;
  cacheWritePrice: number | null;
  cacheHitRate: number | null;
}

export type MetricValue = number | null;

export interface Model {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  creator: Creator;
  releaseDate: string | null;
  deprecated: boolean;
  isReasoning: boolean;
  isOpenWeights: boolean;
  sizeClass: string | null;
  modalities: { image: boolean; speech: boolean; video: boolean };
  intelligenceIndexIsEstimated: boolean;
  metrics: Record<string, MetricValue>;
  usage: ModelUsage;
  cost: ModelCost;
  speed: ModelSpeed;
  pricing: ModelPricing;
}

export interface Dataset {
  version: number;
  source: string;
  sourceUrl: string;
  indexVersion: string;
  fetchedAt: string;
  count: number;
  evals: EvalMeta[];
  models: Model[];
}

export type ChartKind = 'scatter' | 'bar' | 'radar';
export type ViewMode = '2d' | '3d';
export type AxisScale = 'linear' | 'log';
export type SortDir = 'asc' | 'desc';

export interface Filters {
  search: string;
  creators: string[];
  openWeightsOnly: boolean;
  reasoningOnly: boolean;
  hideDeprecated: boolean;
  requireCost: boolean;
  requireSpeed: boolean;
  minIndex: number;
}
