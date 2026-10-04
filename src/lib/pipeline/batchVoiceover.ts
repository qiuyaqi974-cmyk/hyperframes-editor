import { lockedSceneIds } from '@/lib/directorDecision';
import type { TTSProvider, TTSResult } from '@/lib/tts';
import { XunfeiTTS } from '@/lib/tts/xfyun';
import type { Block, ProjectSnapshot, Scene, VoiceProps } from '@/types';

export interface BatchVoiceFailure {
  blockId: string;
  blockName: string;
  message: string;
}

export interface BatchVoiceProgress {
  total: number;
  completed: number;
  currentBlockId?: string;
  currentBlockName?: string;
  generated: number;
  reused: number;
  failures: BatchVoiceFailure[];
  skippedLocked: number;
}

export interface BatchVoiceResult extends BatchVoiceProgress {
  snapshot: ProjectSnapshot;
  overlapWarnings: string[];
}

export interface BatchVoiceOptions {
  provider?: TTSProvider;
  onlyBlockIds?: string[];
  onProgress?: (progress: BatchVoiceProgress) => void;
  resolveDuration?: (result: TTSResult, block: Extract<Block, { type: 'voice' }>) => Promise<number>;
}

export function voiceCacheKey(props: Pick<VoiceProps, 'text' | 'voiceName' | 'speed' | 'volume' | 'pitch'>) {
  return JSON.stringify([
    props.text.trim(),
    props.voiceName || 'x4_lingyuyan',
    props.speed ?? 68,
    props.volume ?? 56,
    props.pitch ?? 48,
  ]);
}

function estimateDuration(text: string) {
  return Math.max(1.2, Number((text.trim().length / 4.2).toFixed(2)));
}

async function audioMetadataDuration(src: string, fallback: number) {
  if (typeof Audio === 'undefined') return fallback;
  return new Promise<number>((resolve) => {
    const audio = new Audio();
    const finish = (value: number) => {
      audio.removeAttribute('src');
      audio.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(fallback), 10_000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallback);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      finish(fallback);
    };
    audio.src = src;
  });
}

function cloneBlock(block: Block): Block {
  return { ...block, position: { ...block.position }, animation: { ...block.animation }, props: { ...block.props } } as Block;
}

function retimeSceneBlocks(blocks: Block[], oldScene: Scene, newScene: Scene) {
  const ratio = oldScene.duration > 0 ? newScene.duration / oldScene.duration : 1;
  return blocks.map((block) => {
    if (block.sceneId !== oldScene.id) return block;
    const copy = cloneBlock(block);
    const relativeStart = Math.max(0, block.start - oldScene.start);
    copy.start = Number((newScene.start + relativeStart * ratio).toFixed(2));
    copy.duration = Number(Math.max(0.1, block.duration * ratio).toFixed(2));
    return copy;
  });
}

/**
 * 为现有 VoiceBlock 批量生成音频，并以真实音频时长重排场景。
 * 锁定场景保持完全不变；其它场景按原顺序从前向后收拢。
 */
export async function generateBatchVoiceover(
  snapshot: ProjectSnapshot,
  options: BatchVoiceOptions = {},
): Promise<BatchVoiceResult> {
  const provider = options.provider ?? new XunfeiTTS();
  const onlyIds = options.onlyBlockIds ? new Set(options.onlyBlockIds) : null;
  const lockedIds = new Set(lockedSceneIds(snapshot.director ?? {
    objective: '', audience: '', thesis: '', contentType: 'knowledge', tone: '', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '', scenes: {}, updatedAt: '',
  }, snapshot.scenes));
  let blocks = snapshot.blocks.map(cloneBlock);
  const voiceBlocks = blocks
    .filter((block): block is Extract<Block, { type: 'voice' }> => block.type === 'voice')
    .sort((a, b) => a.start - b.start || a.layer - b.layer);
  const skippedLocked = voiceBlocks.filter((block) => Boolean(block.sceneId && lockedIds.has(block.sceneId))).length;
  const targets = voiceBlocks.filter((block) =>
    !(block.sceneId && lockedIds.has(block.sceneId))
      && (!onlyIds || onlyIds.has(block.id))
      && block.props.text.trim(),
  );
  const failures: BatchVoiceFailure[] = [];
  let generated = 0;
  let reused = 0;

  const emit = (completed: number, current?: Extract<Block, { type: 'voice' }>) => options.onProgress?.({
    total: targets.length,
    completed,
    currentBlockId: current?.id,
    currentBlockName: current?.name,
    generated,
    reused,
    failures: [...failures],
    skippedLocked,
  });
  emit(0, targets[0]);

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const current = blocks.find((block): block is Extract<Block, { type: 'voice' }> => block.id === target.id && block.type === 'voice');
    if (!current) continue;
    const cacheKey = voiceCacheKey(current.props);
    try {
      if (current.props.src && current.props.generated && current.props.ttsCacheKey === cacheKey && current.props.duration > 0) {
        reused += 1;
      } else {
        const result = await provider.synthesize(current.props.text, {
          voiceName: current.props.voiceName || 'x4_lingyuyan',
          speed: current.props.speed ?? 68,
          volume: current.props.volume ?? 56,
          pitch: current.props.pitch ?? 48,
        });
        const fallback = estimateDuration(current.props.text);
        const duration = await (options.resolveDuration
          ? options.resolveDuration(result, current)
          : result.duration && result.duration > 0
            ? Promise.resolve(result.duration)
            : audioMetadataDuration(result.src, fallback));
        current.props = {
          ...current.props,
          src: result.src,
          duration: Number(Math.max(0.1, duration).toFixed(2)),
          generated: true,
          ttsCacheKey: cacheKey,
        };
        current.duration = current.props.duration;
        generated += 1;
      }
    } catch (error) {
      failures.push({ blockId: current.id, blockName: current.name, message: error instanceof Error ? error.message : String(error) });
    }
    emit(index + 1, targets[index + 1]);
  }

  const originalScenes = [...snapshot.scenes].sort((a, b) => a.start - b.start || a.index - b.index);
  const newScenes: Scene[] = [];
  const overlapWarnings: string[] = [];
  let cursor = 0;

  for (const oldScene of originalScenes) {
    if (lockedIds.has(oldScene.id)) {
      if (oldScene.start < cursor - 0.01) overlapWarnings.push(`锁定场景“${oldScene.text.slice(0, 18)}”与前一场发生重叠。`);
      newScenes.push({ ...oldScene });
      cursor = Math.max(cursor, oldScene.end);
      continue;
    }
    const sceneVoices = blocks
      .filter((block): block is Extract<Block, { type: 'voice' }> => block.type === 'voice' && block.sceneId === oldScene.id)
      .sort((a, b) => a.start - b.start || a.layer - b.layer);
    const newDuration = sceneVoices.length
      ? Number(sceneVoices.reduce((sum, block) => sum + Math.max(0.1, block.props.duration || block.duration), 0).toFixed(2))
      : oldScene.duration;
    const newScene: Scene = {
      ...oldScene,
      start: Number(cursor.toFixed(2)),
      duration: newDuration,
      end: Number((cursor + newDuration).toFixed(2)),
    };
    blocks = retimeSceneBlocks(blocks, oldScene, newScene);
    let voiceCursor = newScene.start;
    blocks = blocks.map((block) => {
      if (block.type !== 'voice' || block.sceneId !== oldScene.id) return block;
      const copy = cloneBlock(block) as Extract<Block, { type: 'voice' }>;
      copy.start = Number(voiceCursor.toFixed(2));
      copy.duration = Math.max(0.1, copy.props.duration || copy.duration);
      voiceCursor += copy.duration;
      return copy;
    });
    newScenes.push(newScene);
    cursor = newScene.end;
  }

  return {
    snapshot: { ...snapshot, blocks, scenes: newScenes, updatedAt: new Date().toISOString() },
    total: targets.length,
    completed: targets.length,
    generated,
    reused,
    failures,
    skippedLocked,
    overlapWarnings,
  };
}
