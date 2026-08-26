import type { Block, CanvasConfig, Scene, VoiceProps } from '@/types';
import { createSubtitleBlock, createVoiceBlock } from '@/lib/blockFactory';
import { XunfeiTTS } from '@/lib/tts/xfyun';

/**
 * 口播生产线：口播稿 → 逐句 TTS → 按每句音频时长锁定时间线。
 *
 * 这是与 Remotion 视频生产线对齐的核心步骤——
 * Remotion 管线中「口播按 9 段音频时长锁定画面」在这里变成
 * 可视化可调的：每句生成一个 VoiceBlock + 一条字幕 + 一个场景，
 * 后续素材用「自动匹配到字幕」对位，最后导出 MP4。
 */

export interface VoiceoverOptions {
  voiceName?: string;
  speed?: number;
  volume?: number;
  /** 拿不到真实音频时长时的兜底估算（秒/字），讯飞语速 60 约 4.2 字/秒 */
  charsPerSecond?: number;
}

export interface VoiceoverTimeline {
  scenes: Scene[];
  blocks: Block[];
}

/** 把整篇口播稿切成句子：按中英文句末标点与换行切分，丢弃空白与纯标点碎片 */
export function splitScript(script: string): string[] {
  return script
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?；;.])|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[\u4e00-\u9fa5A-Za-z0-9]/.test(sentence));
}

/** 讯飞语速 60 时中文约 4.2 字/秒；拿不到 metadata 前的兜底估算 */
function estimateDuration(text: string, charsPerSecond: number): number {
  return Math.max(1.2, Number((text.length / charsPerSecond).toFixed(2)));
}

/**
 * 逐句合成配音并生成时间线：
 * - 每句一个 VoiceBlock（source: 'pipeline'，重复执行时整体替换）
 * - 每句一条字幕（source: 'srt'，与 SRT 导入同一轨道语义）
 * - 每句一个场景（时间轴场景轨 + 素材自动匹配的锚点）
 */
export async function synthesizeScript(
  script: string,
  canvas: CanvasConfig,
  options: VoiceoverOptions = {},
): Promise<VoiceoverTimeline> {
  const sentences = splitScript(script);
  if (!sentences.length) throw new Error('口播稿没有切出任何句子');

  const tts = new XunfeiTTS();
  const charsPerSecond = options.charsPerSecond ?? 4.2;
  const blocks: Block[] = [];
  const scenes: Scene[] = [];
  let layer = 0;
  let cursor = 0;

  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i];
    const result = await tts.synthesize(sentence, {
      voiceName: options.voiceName ?? 'x6_lingyuyan_pro',
      speed: options.speed ?? 60,
      volume: options.volume ?? 50,
    });
    const duration = Number(
      (result.duration ?? estimateDuration(sentence, charsPerSecond)).toFixed(2),
    );

    const voiceBlock = createVoiceBlock(canvas, layer++, cursor);
    voiceBlock.name = `配音 ${i + 1}`;
    voiceBlock.props = {
      ...voiceBlock.props,
      text: sentence,
      src: result.src,
      duration,
      generated: true,
      voiceName: options.voiceName ?? 'x6_lingyuyan_pro',
      speed: options.speed ?? 60,
      volume: options.volume ?? 50,
    } as VoiceProps;
    voiceBlock.start = cursor;
    voiceBlock.duration = duration;
    voiceBlock.source = 'pipeline';
    blocks.push(voiceBlock);

    const subtitleBlock = createSubtitleBlock(canvas, layer++, cursor);
    subtitleBlock.name = `字幕 ${i + 1}`;
    subtitleBlock.props.text = sentence;
    subtitleBlock.start = cursor;
    subtitleBlock.duration = duration;
    subtitleBlock.animation = { ...subtitleBlock.animation, duration: Math.min(0.22, duration / 3) };
    subtitleBlock.source = 'srt';
    blocks.push(subtitleBlock);

    scenes.push({
      id: `scene_${String(i + 1).padStart(3, '0')}`,
      index: i + 1,
      start: cursor,
      end: Number((cursor + duration).toFixed(2)),
      duration,
      text: sentence,
    });

    cursor = Number((cursor + duration).toFixed(2));
  }

  return { scenes, blocks };
}
