import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 提供 /api/aa/refresh：服务端重新抓取源站数据（浏览器直连会被 CORS 拦截），
 * 并把结果回写到 public/data，实现「刷新数据」按钮。
 */
function aaRefreshApi() {
  const handler = async (req, res, next) => {
    if (!req.url?.startsWith('/api/aa/refresh')) return next?.();
    try {
      // @ts-ignore - 运行时动态导入 .mjs 数据管线
      const { buildDataset } = await import('./server/aaSource.mjs');
      const data = await buildDataset();
      const file = path.resolve(process.cwd(), 'public', 'data', 'aa-intelligence-index.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(data));
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  };
  return {
    name: 'aa-refresh-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), aaRefreshApi()],
  server: { port: 5173, host: true },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts'],
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
