import { createServer } from 'node:http';
import { xfyunTTSProxy } from './xfyun-tts-proxy';
import { loadLocalEnv } from './loadLocalEnv';

/**
 * 独立 TTS 服务。
 *
 * vite dev server 内置了同一个代理（见 vite.config.ts）；但在
 * `vite build` 后的静态部署 / preview 场景下没有 dev server，
 * 启动这个独立服务即可补上 /api/tts/xunfei 端点：
 *
 *   npm run server:tts
 *
 * 前端通过 VITE_TTS_BASE_URL 指向它（如 http://127.0.0.1:5179）。
 */
loadLocalEnv();

const port = Number(process.env.TTS_PORT || 5179);

createServer((req, res) => {
  // 与 vite 中间件保持相同的挂载路径
  if (req.url?.startsWith('/api/tts/xunfei')) {
    xfyunTTSProxy(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
    return;
  }
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: '未知的路径。' }));
}).listen(port, () => {
  console.log(`HyperFrames TTS 服务已启动：http://127.0.0.1:${port}/api/tts/xunfei`);
});
