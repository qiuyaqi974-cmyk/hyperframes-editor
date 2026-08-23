import { CANVAS_DEFAULT, createSubtitleBlock, createTextBlock, createVoiceBlock } from '@/lib/blockFactory';
import type { ProjectSnapshot } from '@/types';
import { getLayoutPosition } from '@/lib/layout/layoutPreset';

export interface AgentProjectInput {
  topic: string;
  script: string;
}

/**
 * 把主题和脚本转换成 HyperFrames 可直接编辑的工程快照。
 * 这里不调用模型，也不负责 TTS；它只是未来 Agent 与编辑器之间的稳定边界。
 */
export function generateProjectSnapshot(input: AgentProjectInput): ProjectSnapshot {
  const topic = input.topic.trim() || '未命名主题';
  const script = input.script.trim();
  if (!script) throw new Error('脚本不能为空。');

  const canvas = { ...CANVAS_DEFAULT };
  const estimatedDuration = Math.min(60, Math.max(3, Math.ceil((script.length / 4.5) * 2) / 2));

  const title = createTextBlock(canvas, 0, 0);
  title.name = 'AI标题';
  title.layoutPreset = 'top-title';
  title.position = getLayoutPosition(title.layoutPreset);
  title.props.text = topic;
  title.props.fontSize = 108;
  title.props.maxWidth = 1400;
  title.duration = Math.min(4, estimatedDuration);

  const voice = createVoiceBlock(canvas, 1, 0);
  voice.name = 'AI旁白';
  voice.layoutPreset = 'center-product';
  voice.position = getLayoutPosition(voice.layoutPreset);
  voice.props.text = script;
  voice.props.src = null;
  voice.props.duration = 0;
  voice.props.generated = false;
  voice.duration = estimatedDuration;

  const subtitle = createSubtitleBlock(canvas, 2, 0);
  subtitle.name = 'AI字幕占位';
  subtitle.layoutPreset = 'bottom-subtitle';
  subtitle.position = getLayoutPosition(subtitle.layoutPreset);
  subtitle.props.text = script;
  subtitle.duration = estimatedDuration;

  return {
    app: 'hyperframes-editor',
    version: 4,
    themeId: 'midnight',
    projectName: topic,
    canvas,
    blocks: [title, voice, subtitle],
    assets: [],
    narration: null,
    scenes: [],
    updatedAt: new Date().toISOString(),
  };
}
