import type { TTSConfig, TTSProvider, TTSResult } from './index';

/**
 * 讯飞 TTS 服务占位。
 *
 * 真实实现需要在这里完成 WebSocket 鉴权、HMAC-SHA256 签名和音频帧拼接；
 * 组件层只依赖 TTSProvider，因此后续替换为真实实现不会影响编辑器。
 */
export class XunfeiTTS implements TTSProvider {
  async synthesize(text: string, config: TTSConfig): Promise<TTSResult> {
    console.info('讯飞 TTS 请求（占位）:', { text, config });
    throw new Error('Xunfei TTS API not implemented');
  }
}
