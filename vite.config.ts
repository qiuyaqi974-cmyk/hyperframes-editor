import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { xfyunTTSProxy } from './server/xfyun-tts-proxy';

export default defineConfig({
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
      },
    },
  ],
});
