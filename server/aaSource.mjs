/**
 * Artificial Analysis 智能指数数据源。
 *
 * 数据获取链路：
 *  1. 抓取评测页 HTML，还原内联 RSC Flight 载荷；
 *  2. 从载荷中取得 `initialModels`（默认选中的 31 个模型，作为兜底）与 `manifest` 引用
 *     （`{path, key}`，key 为页面随请求下发的 AES 密钥）；
 *  3. 拉取 manifest 数据文件（AES-256-GCM 密文，IV = SHA-256(key) 前 12 字节，tag 在末尾 16 字节），
 *     解密 + gunzip 后得到**全量 643 条模型记录**（其中 630 条有智能指数）；
 *  4. 按站点前端同款公式派生每任务 Token / 成本 / 总花费 / 耗时。
 *
 * 成本口径（复刻站点模块 35073/91223）：
 *  - 每项评测：input 拆分为 未缓存输入 / 缓存读取 / 缓存写入（按 cacheHitRate），
 *    读取/写入价格缺失时**回退到输入单价**；
 *  - 每任务成本 = Σ_e (评测全量成本_e / taskCount_e × weight_e)；
 *  - 总花费 = Σ_e 评测全量成本_e（不按任务数摊薄）。
 */

import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const SOURCE_URL =
  'https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index';

export const DATASET_VERSION = 3;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * Artificial Analysis Intelligence Index 的组成评测（v4.1.1，权重合计 1）。
 * taskCount / taskWeight 取自站点前端。
 */
export const INDEX_EVALS = [
  { key: 'gdpval', label: 'GDPval-AA v2', taskCount: 220, weight: 0.2 },
  { key: 'tauBanking', label: '𝜏³-Banking', taskCount: 97, weight: 0.14 },
  { key: 'terminalbenchV21', label: 'Terminal-Bench v2.1', taskCount: 89, weight: 0.16 },
  { key: 'scicode', label: 'SciCode', taskCount: 288, weight: 0.08 },
  { key: 'hle', label: "Humanity's Last Exam", taskCount: 2158, weight: 0.12 },
  { key: 'omniscience', label: 'AA-Omniscience', taskCount: 6000, weight: 0.12 },
  { key: 'gpqa', label: 'GPQA Diamond', taskCount: 198, weight: 0.06 },
  { key: 'critpt', label: 'CritPt', taskCount: 70, weight: 0.06 },
  { key: 'lcr', label: 'AA-LCR', taskCount: 100, weight: 0.06 },
];

const EXTRA_EVALS = [
  'briefcaseElo',
  'harveyLab',
  'mmluPro',
  'livecodebench',
  'math500',
  'aime25',
  'ifbench',
  'mmmuPro',
  'mlcrOverall',
  'tau2',
  'terminalbenchHard',
  'globalMmluLiteScore',
  'analystAgent',
  'apexAgents',
  'automationBenchPartialScore',
  'enterpriseOpsGym',
  'itbenchSre',
  'opennessIndex',
];

async function fetchBuffer(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: '*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs) {
  return (await fetchBuffer(url, timeoutMs)).toString('utf8');
}

/** 还原 `self.__next_f.push([1,"..."])` 中的 Flight 载荷分片。 */
export function extractFlightPayload(html) {
  const re = /self\.__next_f\.push\(\[1,("(?:\\[\s\S]|[^"\\])*")\]\)/g;
  const parts = [];
  let m;
  while ((m = re.exec(html))) {
    try {
      parts.push(JSON.parse(m[1]));
    } catch {
      /* 忽略无法解析的分片 */
    }
  }
  if (!parts.length) throw new Error('未在页面中定位到 RSC 数据载荷，站点结构可能已变更');
  return parts.join('');
}

/** 从 `{"key":[...]` / `{"key":{...}` 处提取完整 JSON 值（处理转义与嵌套）。 */
function extractJsonValue(payload, key, openChar) {
  const start = payload.indexOf(`"${key}"`);
  if (start < 0) return null;
  const open = payload.indexOf(openChar, start);
  if (open < 0) return null;
  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < payload.length; i++) {
    const ch = payload[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return payload.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * 解密 manifest 数据文件（与站点模块 57455 等价）：
 * key = hex 解码，IV = SHA-256(key) 前 12 字节，AES-256-GCM，tag 为密文末尾 16 字节，明文为 gzip。
 */
export function decryptManifest(hexKey, cipher) {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.createHash('sha256').update(key).digest().subarray(0, 12);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  return zlib.gunzipSync(plain).toString('utf8');
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 将 input token 拆分为 未缓存输入 / 缓存读取 / 缓存写入。
 * 与站点 `Mm` 一致：无 cacheableInput 时全部计入未缓存输入。
 */
function splitInput(counts, cacheHitRate) {
  const input = num(counts?.input);
  if (input == null) return null;
  const cacheable = num(counts.cacheableInput);
  if (cacheable == null) return { nonCacheInput: input, cacheRead: 0, cacheWrite: 0 };
  if (cacheHitRate == null) return null;
  const cacheRead = cacheable * cacheHitRate;
  return { nonCacheInput: 0, cacheRead, cacheWrite: Math.max(0, input - cacheRead) };
}

/**
 * 单项评测全量运行的费用（USD）。
 * 与站点 `o` 一致：cacheHit / cacheWrite 单价缺失时回退到输入单价。
 */
function evalFullCost(counts, split, price) {
  const reasoning = num(counts.reasoning) ?? 0;
  const answer = num(counts.answer) ?? 0;
  const inputCost =
    (split.nonCacheInput * price.input +
      split.cacheRead * (price.cacheHit ?? price.input) +
      split.cacheWrite * (price.cacheWrite ?? price.input)) /
    1e6;
  const outputCost = ((reasoning + answer) * price.output) / 1e6;
  return { total: inputCost + outputCost, input: inputCost, output: outputCost };
}

function hasPrices(raw) {
  return num(raw.price1mInputTokens) != null && num(raw.price1mOutputTokens) != null;
}

/**
 * 由原始模型记录派生全部指标。
 * 任一组成评测缺失 -> 依赖它的派生指标为 null（与站点「Not publicly available」一致）。
 */
function deriveMetrics(raw) {
  const counts = raw.canonicalEvalTokenCounts || {};
  const cacheHitRate = num(raw.cacheHitRate);
  const outputSpeed = num(raw.medianCanonicalAnswerOutputSpeed);
  const price = hasPrices(raw)
    ? {
        input: raw.price1mInputTokens,
        output: raw.price1mOutputTokens,
        cacheHit: num(raw.cacheHitPrice),
        cacheWrite: num(raw.cacheWritePrice),
      }
    : null;

  let inputPerTask = 0;
  let reasoningPerTask = 0;
  let answerPerTask = 0;
  let costPerTask = 0;
  let totalCost = 0;
  let secondsPerTask = 0;
  let okUsage = true;
  let okCost = true;
  let okTime = outputSpeed != null && outputSpeed > 0;

  const breakdown = { input: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, answer: 0 };
  const perEval = [];

  for (const ev of INDEX_EVALS) {
    const c = counts[ev.key];
    if (!c) {
      okUsage = false;
      okCost = false;
      okTime = false;
      continue;
    }
    const reasoning = num(c.reasoning) ?? 0;
    const answer = num(c.answer) ?? 0;
    const input = num(c.input) ?? 0;

    inputPerTask += (input / ev.taskCount) * ev.weight;
    reasoningPerTask += (reasoning / ev.taskCount) * ev.weight;
    answerPerTask += (answer / ev.taskCount) * ev.weight;
    if (okTime) secondsPerTask += ((reasoning + answer) / ev.taskCount / outputSpeed) * ev.weight;

    const split = splitInput(c, cacheHitRate);
    if (price && split) {
      const full = evalFullCost(c, split, price);
      costPerTask += (full.total / ev.taskCount) * ev.weight;
      totalCost += full.total;
      // 按 token 类别拆分到「每任务」口径（USD）
      breakdown.input += (split.nonCacheInput * price.input * ev.weight) / ev.taskCount / 1e6;
      breakdown.cacheRead += (split.cacheRead * (price.cacheHit ?? price.input) * ev.weight) / ev.taskCount / 1e6;
      breakdown.cacheWrite += (split.cacheWrite * (price.cacheWrite ?? price.input) * ev.weight) / ev.taskCount / 1e6;
      breakdown.reasoning += (reasoning * price.output * ev.weight) / ev.taskCount / 1e6;
      breakdown.answer += (answer * price.output * ev.weight) / ev.taskCount / 1e6;
      perEval.push({ key: ev.key, label: ev.label, taskCount: ev.taskCount, weight: ev.weight, fullCost: full.total });
    } else {
      okCost = false;
      perEval.push({ key: ev.key, label: ev.label, taskCount: ev.taskCount, weight: ev.weight, fullCost: null });
    }
    perEval[perEval.length - 1].inputTokens = input;
    perEval[perEval.length - 1].reasoningTokens = reasoning;
    perEval[perEval.length - 1].answerTokens = answer;
  }

  const scores = {
    intelligenceIndex: num(raw.intelligenceIndex),
    gdpval: num(raw.gdpval),
    tauBanking: num(raw.tauBanking),
    terminalbenchV21: num(raw.terminalbenchV21),
    scicode: num(raw.scicode),
    hle: num(raw.hle),
    gpqa: num(raw.gpqa),
    critpt: num(raw.critpt),
    omniscience: num(raw.omniscience),
    lcr: num(raw.lcr),
  };
  for (const k of EXTRA_EVALS) scores[k] = num(raw[k]);

  const releaseTs = raw.releaseDate ? Date.parse(`${raw.releaseDate}T00:00:00Z`) : null;
  const outputPerTask = reasoningPerTask + answerPerTask;

  const metrics = {
    ...scores,
    releaseTs: Number.isFinite(releaseTs) ? releaseTs : null,
    inputTokensPerTask: okUsage ? inputPerTask : null,
    outputTokensPerTask: okUsage ? outputPerTask : null,
    reasoningTokensPerTask: okUsage ? reasoningPerTask : null,
    answerTokensPerTask: okUsage ? answerPerTask : null,
    costPerTask: okCost ? costPerTask : null,
    totalCost: okCost ? totalCost : null,
    timePerTask: okTime ? secondsPerTask / 60 : null,
    outputSpeed,
    price1mInputTokens: num(raw.price1mInputTokens),
    price1mOutputTokens: num(raw.price1mOutputTokens),
    cacheHitPrice: num(raw.cacheHitPrice),
    cacheWritePrice: num(raw.cacheWritePrice),
    cacheHitRate,
    activeParams: num(raw.activeParams),
    parameters: num(raw.parameters),
  };

  return {
    metrics,
    usage: {
      inputTokensPerTask: metrics.inputTokensPerTask,
      outputTokensPerTask: metrics.outputTokensPerTask,
      reasoningTokensPerTask: metrics.reasoningTokensPerTask,
      answerTokensPerTask: metrics.answerTokensPerTask,
      perEval,
    },
    cost: {
      costPerTask: metrics.costPerTask,
      totalCost: metrics.totalCost,
      breakdownPerTask: okCost ? breakdown : null,
    },
    speed: { outputSpeed, timePerTask: metrics.timePerTask },
  };
}

/** 过暗的品牌色提升可读性（暗色主题），保持色相不变。 */
function visibleColor(hex, fallback = '#7aa2f7') {
  if (typeof hex !== 'string') return fallback;
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l >= 0.6) return `#${m[1].toLowerCase()}`;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const hue = ((h * 60) % 360 + 360) % 360;
  const L = Math.min(0.72, Math.max(0.62, l));
  const c = (1 - Math.abs(2 * L - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m0 = L - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const table = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [rr, gg, bb] = table[seg];
  const to = (v) => Math.round((v + m0) * 255).toString(16).padStart(2, '0');
  return `#${to(rr)}${to(gg)}${to(bb)}`;
}

function normalize(raw) {
  const d = deriveMetrics(raw);
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    shortName: raw.shortName || raw.name,
    creator: raw.creator
      ? {
          id: raw.creator.id,
          slug: raw.creator.slug,
          name: raw.creator.name,
          color: visibleColor(raw.creator.color),
          logo: raw.creator.logo || null,
        }
      : { id: null, slug: 'unknown', name: '其他', color: '#8b93a7', logo: null },
    releaseDate: raw.releaseDate || null,
    deprecated: !!raw.deprecated,
    isReasoning: !!raw.isReasoning,
    isOpenWeights: !!raw.isOpenWeights,
    sizeClass: raw.sizeClass || null,
    modalities: {
      image: !!raw.inputModalityImage,
      speech: !!raw.inputModalitySpeech,
      video: !!raw.inputModalityVideo,
    },
    intelligenceIndexIsEstimated: !!raw.intelligenceIndexIsEstimated,
    metrics: d.metrics,
    usage: d.usage,
    cost: d.cost,
    speed: d.speed,
    pricing: {
      price1mInputTokens: d.metrics.price1mInputTokens,
      price1mOutputTokens: d.metrics.price1mOutputTokens,
      cacheHitPrice: d.metrics.cacheHitPrice,
      cacheWritePrice: d.metrics.cacheWritePrice,
      cacheHitRate: d.metrics.cacheHitRate,
    },
  };
}

/** 抓取并构建完整数据集。 */
export async function buildDataset({ timeoutMs = 60_000 } = {}) {
  const html = await fetchText(SOURCE_URL, timeoutMs);
  const payload = extractFlightPayload(html);

  const initialRaw = extractJsonValue(payload, 'initialModels', '[');
  const initialModels = initialRaw ? JSON.parse(initialRaw) : [];
  const inlineFallback = extractJsonValue(payload, 'fallbackPriceByModelSlug', '{');
  const manifestRef = payload.match(/"manifest":\{"path":"([^"]+)","key":"([0-9a-f]+)"\}/);

  let source = 'page';
  let manifestFallbackPrices = {};
  let list = initialModels;

  if (manifestRef) {
    try {
      const url = new URL(manifestRef[1], SOURCE_URL).href;
      const cipher = await fetchBuffer(url, timeoutMs);
      const json = JSON.parse(decryptManifest(manifestRef[2], cipher));
      manifestFallbackPrices = json.fallbackPriceByModelSlug ?? {};
      if (Array.isArray(json.models) && json.models.length >= initialModels.length) {
        list = json.models;
        source = 'manifest';
      }
    } catch {
      /* manifest 不可用时回退到页面内联数据 */
    }
  }
  if (Object.keys(manifestFallbackPrices).length === 0 && inlineFallback) {
    try {
      manifestFallbackPrices = JSON.parse(inlineFallback);
    } catch {
      /* ignore */
    }
  }
  void manifestFallbackPrices;

  const kept = list.filter((m) => m.intelligenceIndex != null);
  if (!kept.length) throw new Error('未解析到任何有效模型数据');

  const models = kept.map(normalize).sort((a, b) => b.metrics.intelligenceIndex - a.metrics.intelligenceIndex);

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const versionMatch = titleMatch?.[1]?.match(/v(\d+\.\d+(?:\.\d+)?)/);

  return {
    version: DATASET_VERSION,
    source: 'Artificial Analysis',
    sourceUrl: SOURCE_URL,
    sourceLayer: source,
    indexVersion: versionMatch ? `v${versionMatch[1]}` : 'v4.x',
    fetchedAt: new Date().toISOString(),
    count: models.length,
    totalDiscovered: list.length,
    evals: INDEX_EVALS.map(({ key, label, taskCount, weight }) => ({ key, label, taskCount, weight })),
    models,
  };
}
