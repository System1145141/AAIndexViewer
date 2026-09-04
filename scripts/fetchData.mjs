/**
 * 抓取 Artificial Analysis 智能指数数据并写入 public/data/aa-intelligence-index.json。
 * 用法：npm run fetch:data
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, SOURCE_URL } from '../server/aaSource.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'public', 'data', 'aa-intelligence-index.json');

const data = await buildDataset();

// manifest 不可用时会回退到页面内联的 31 个模型，直接部署等于把站点降级，
// 因此这里设一道下限，宁可让 CI 失败并保留线上旧版本
if (data.count < 100) {
  throw new Error(`只解析到 ${data.count} 个模型，疑似抓取异常，已中止（保留上一版数据）`);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
// 不缩进：快照要作为静态资源下发，体积 2.84MB → 1.8MB（Cloudflare 还会自动压缩传输）
fs.writeFileSync(outFile, JSON.stringify(data), 'utf8');

const withCost = data.models.filter((m) => m.metrics.costPerTask != null).length;
const withSpeed = data.models.filter((m) => m.metrics.outputSpeed != null).length;
console.log(`[aa] 源站: ${SOURCE_URL}`);
console.log(`[aa] 版本: ${data.indexVersion} | 抓取时间: ${data.fetchedAt}`);
console.log(`[aa] 模型数: ${data.count}（含成本 ${withCost} / 含速度 ${withSpeed}）`);
console.log(`[aa] 已写入: ${path.relative(root, outFile)}`);
for (const m of data.models.slice(0, 5)) {
  const c = m.metrics.costPerTask;
  const t = m.metrics.timePerTask;
  console.log(
    `    ${m.metrics.intelligenceIndex.toFixed(1)}  ${m.name}  ` +
      `输出/任务=${Math.round(m.metrics.outputTokensPerTask ?? 0)} tok  ` +
      `花费/任务=${c != null ? `$${c.toFixed(2)}` : '—'}  ` +
      `耗时/任务=${t != null ? `${t.toFixed(1)} min` : '—'}  ` +
      `速度=${m.metrics.outputSpeed != null ? `${m.metrics.outputSpeed.toFixed(0)} tok/s` : '—'}`,
  );
}
