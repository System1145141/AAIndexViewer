# AA 智能指数可视化探索器

对 [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index)
评测数据进行可视化探索的本地 Web 应用：二维图表、三维场景、模型对比、悬停详情、排序筛选、缓存与导出。

## 功能一览

| 模块 | 说明 |
| --- | --- |
| 数据获取 | 解析源站页面内联的 RSC Flight 载荷，提取 `initialModels` 模型数组；并按站点前端的同款公式派生 Token / 成本 / 耗时指标 |
| 二维图表 | 散点图（X/Y/气泡大小可任选指标，线性/对数坐标）、柱状图（Top N、可切换坐标）、雷达图（维度可任选） |
| 三维场景 | three.js 节点云，X/Y/Z 三轴分别映射任意指标，节点大小与颜色按指标映射（或按厂商着色），支持旋转/缩放/平移、悬停数据卡、点击加入对比 |
| 模型对比 | 多选模型并排对比，逐指标高亮最优/最差并给出相对差值，自动生成中文对比摘要 |
| 交互 | 悬停显示详细数据，点击图表节点打开单模型完整指标面板，支持按任意指标排序与多维筛选 |
| 持久化 | 数据集与视图偏好写入 localStorage（6 小时缓存），支持导出 CSV / PNG |

## 数据获取链路

源站页面的模型数据分两层下发：

1. **页面内联 RSC Flight 载荷**：仅含默认选中的 31 个模型（兜底数据），以及 `manifest` 引用
   `{path, key}`（key 为随页面下发的 AES 密钥）与内联 `fallbackPriceByModelSlug`；
2. **manifest 数据文件**：`path` 指向的文件是 AES-256-GCM 密文（IV = SHA-256(key) 前 12 字节，
   tag 在密文末尾 16 字节），解密 + gunzip 后得到**全量 643 条模型记录**（630 条有智能指数）。

管线在 Node 端完整复刻该解密流程（`server/aaSource.mjs` 的 `decryptManifest`），
manifest 不可用时自动回退到页面内联数据。

## 派生指标口径

源站对部分模型的成本/速度标注 "Not publicly available"，本项目与其前端计算口径一致
（复刻模块 35073 / 91223 / 43859）：

- **每任务 Token**：`Σ_e (tokens_e / taskCount_e × weight_e)`，按推理 / 回答 / 输入分别累计；
  九项评测任一缺失即视为不可用（与源站一致）；
- **每任务花费**：`Σ_e (评测全量成本_e / taskCount_e × weight_e)`；费用 = 未缓存输入 × 输入价
  + 缓存读取 × 缓存命中价 + 缓存写入 × 缓存写入价 + (推理 + 回答) × 输出价，
  其中**缓存命中/写入单价缺失时回退到输入单价**（例如 DeepSeek V4 Pro 未公开缓存写入价，
  源站显示 $0.27/任务，本项目算得 $0.265）；
- **全量评测总花费**：`Σ_e 评测全量成本_e`（不按任务数摊薄）；
- **每任务耗时**：`Σ_e ((answer+reasoning)_e / taskCount_e / outputSpeed) × weight_e`（分钟）。

- **每任务 Token**：`Σ_e (tokens_e / taskCount_e × weight_e)`，按推理 / 回答 / 输入分别累计；
- **每任务花费**：`Σ_e (费用_e / taskCount_e × weight_e)`，费用按未缓存输入、缓存读取、缓存写入、推理与回答五类 Token 计价；
- **全量评测总花费**：`Σ_e 费用_e`（不除以任务数）；
- **每任务耗时**：`Σ_e ((answer+reasoning)_e / taskCount_e / speed) × weight_e`（分钟）。

九项组成评测的任务数与权重取自站点前端（v4.1.1）：

| 评测 | 任务数 | 权重 |
| --- | --- | --- |
| GDPval-AA v2 | 220 | 20% |
| Terminal-Bench v2.1 | 89 | 16% |
| 𝜏³-Banking | 97 | 14% |
| Humanity's Last Exam | 2158 | 12% |
| AA-Omniscience | 6000 | 12% |
| SciCode | 288 | 8% |
| AA-LCR | 100 | 6% |
| GPQA Diamond | 198 | 6% |
| CritPt | 70 | 6% |

站点切换到 v4.2 时权重可能变化，如指标与官网出现偏差请重新抓取并核对 `server/aaSource.mjs` 中的 `INDEX_EVALS`。

## 快速开始

```bash
npm install

# 可选：从源站重新抓取数据，写入 public/data/aa-intelligence-index.json
npm run fetch:data

npm run dev        # 开发模式，默认 http://localhost:5173
npm run build      # 类型检查 + 产物构建
npm run preview    # 预览生产构建
```

数据快照（`public/data/aa-intelligence-index.json`）不入库，需执行一次 `npm run fetch:data` 生成；
生成后即使源站临时不可访问，应用也能离线运行。

## 数据刷新机制

- 首次加载：优先读 localStorage 缓存（6 小时内有效），否则读取内置快照；
- 点击「刷新数据」：请求 `/api/aa/refresh`，由服务端重新抓取源站并回写快照文件；
- 若刷新失败（离线、源站结构变更），自动回退到内置快照或本地缓存并提示原因。

> 浏览器直连 `artificialanalysis.ai` 会被 CORS 拦截，因此刷新必须经由本地服务端完成；
> `/api/aa/refresh` 由 `vite.config.ts` 中的插件在 `vite dev` 与 `vite preview` 下同时提供。

## 部署：Cloudflare 静态资源 + GitHub Actions 定时刷新

线上采用**纯静态**形态：`dist/` 作为 Cloudflare Workers 静态资源分发，数据由 GitHub Actions
定时抓取后随构建产物一起上传。线上没有 Worker 脚本，因此不受 Workers 的 CPU 时间限制
（免费版 10ms 的坑完全绕开），刷新按钮在静态构建中也被移除。

```
GitHub Actions（每 6 小时 / push 到 main）
  └─ npm run fetch:data   抓取源站 → public/data/*.json
  └─ npm run build        VITE_ENABLE_REFRESH=false 构建
  └─ npm run deploy       wrangler deploy → Cloudflare 静态资源
```

### 首次配置

1. 在 Cloudflare 创建一个有 **Workers** 权限的 API Token，记下 Account ID；
2. 到仓库 *Settings → Secrets and variables → Actions* 添加两个 secret：
   `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；
3. 推送到 `main`，或到 *Actions* 面板手动 **Run workflow** 触发首次部署。

### 几个设计取舍

- **快照不进 Git**：1.8MB / 次，若提交会迅速撑爆仓库历史；改为部署前现场抓取。
- **cron 避开整点**（`23 */6 * * *`）：GitHub 在高负载时会延迟定时任务，极端情况会丢弃排队任务。
- **每次运行提交一个时间戳文件**：公开仓库 60 天无任何活动会自动停用定时任务，
  `.last-data-refresh` 只用几字节就维持住仓库活动（该路径已加入 `paths-ignore`，不会触发递归构建）。
- **抓取失败即中止部署**：解析到的模型少于 100 个时脚本直接报错，线上继续保留上一版数据。

## 深链参数

- `#mode=3d`：直接进入三维场景；
- `#chart=radar|bar|scatter`：直接打开指定二维图表；
- `#x=costPerTask&y=intelligenceIndex`：指定散点图坐标轴（亦支持 `z=` / `size=`）；
- `#detail=<slug>`：直接打开某个模型的详情面板（如 `#detail=deepseek-v4-pro`）。

## 目录结构

```
server/aaSource.mjs        抓取 + RSC 解析 + 指标派生（Node，无第三方依赖）
scripts/fetchData.mjs      CLI 抓取脚本，生成内置快照
vite.config.ts             dev/preview 共用的 /api/aa/refresh 中间件
wrangler.jsonc             Cloudflare 静态资源部署配置（纯静态，无 Worker 脚本）
public/_headers            静态资源缓存策略（快照短缓存、带哈希产物长缓存）
.github/workflows/         定时抓取 + 构建 + 部署
public/data/*.json         内置数据快照（本地生成，不入库）
src/metrics.ts             指标注册表：单位、方向、格式化、归一化
src/store.ts               zustand 全局状态 + localStorage 持久化 + 筛选/排序
src/components/Chart2D.tsx ECharts 二维图表（散点/柱状/雷达）
src/components/Scene3D.tsx three.js 三维节点场景
src/components/CompareDock.tsx  对比表 + 差值高亮 + 摘要生成
src/components/ModelDetail.tsx  单模型完整指标面板
src/utils/exporters.ts     CSV / PNG 导出（对比图由 Canvas 绘制，无额外依赖）
```
