import type { TTSConfig, TTSProvider, TTSResult } from './index';

/**
 * 讯飞 TTS 客户端。密钥留在 Vite 的本地服务端代理中，浏览器只拿音频 data URL。
 */
export class XunfeiTTS implements TTSProvider {
  async synthesize(text: string, config: TTSConfig): Promise<TTSResult> {
    const response = await fetch('/api/tts/xunfei', {
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
