import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { xfyunTTSProxy } from './server/xfyun-tts-proxy';
import { webCaptureHandler } from './server/web-capture';
import { loadLocalEnv } from './server/loadLocalEnv';

// TTS 代理运行在 dev server 进程里，需要和 Electron 主进程拿到同一份密钥
loadLocalEnv();

export default defineConfig({
  build: {
    manifest: true,
    // ExcelJS 是用户导入工作簿时才加载的独立功能包；首屏与 AI 工作台均不下载它。
    chunkSizeWarningLimit: 1000,
  },
  resolve: {
    alias: {
      // package.json 是 type: module，这里不能用 __dirname
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5178,
    host: true,
    open: false,
  },
  plugins: [
    react(),
    {
      name: 'local-xfyun-tts-proxy',
      configureServer(server) {
        server.middlewares.use('/api/tts/xunfei', xfyunTTSProxy);
        server.middlewares.use('/api/capture/web', webCaptureHandler);
      },
    },
  ],
});
