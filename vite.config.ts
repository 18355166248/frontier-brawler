import { defineConfig } from 'vite';

export default defineConfig({
  // 生产包可直接放在任意静态站点子目录，不依赖域名根路径。
  base: './',
  server: { port: 5180, strictPort: true },
  build: { target: 'es2022' },
});
