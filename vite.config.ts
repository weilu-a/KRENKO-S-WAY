import { defineConfig } from 'vite';

export default defineConfig({
  base: '/dev/2d_game_template/',
  server: {
    port: 5179,
    strictPort: true,
    host: true,
    // 浏览器直连 Ollama 常遇 CORS；开发时把 /ollama 代理到本机 11434
    proxy: {
      '/ollama': {
        target: 'http://127.0.0.1:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
      /** 开发时若直连方舟域名被 CORS 拦截，可在 .env 设 VITE_ARK_BASE_URL=/ark-api/api/v3 */
      '/ark-api': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ark-api/, ''),
      },
    },
  },
  publicDir: 'assets',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
