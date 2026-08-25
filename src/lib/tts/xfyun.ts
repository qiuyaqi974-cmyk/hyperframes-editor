import type { TTSConfig, TTSProvider, TTSResult } from './index';

/**
 * 讯飞 TTS 客户端。密钥留在服务端代理中，浏览器只拿音频 data URL。
 *
 * 代理地址：默认走同源 `/api/tts/xunfei`（vite dev server 内置）；
 * 静态部署 / preview 场景可通过 VITE_TTS_BASE_URL 指向独立 TTS 服务
 * （`npm run server:tts`，见 server/tts-server.ts）。
 */
const endpoint = `${import.meta.env.VITE_TTS_BASE_URL ?? ''}/api/tts/xunfei`;

export class XunfeiTTS implements TTSProvider {
  async synthesize(text: string, config: TTSConfig): Promise<TTSResult> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...config }),
    });
    const payload = (await response.json()) as Partial<TTSResult> & { error?: string };
    if (!response.ok || !payload.src) {
      throw new Error(payload.error || `TTS 请求失败（HTTP ${response.status}）`);
    }
    return { src: payload.src, duration: payload.duration };
  }
}
