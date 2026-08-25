import type { ProjectSnapshot } from '@/types';
import { compositionDuration } from '@/lib/animation';

/** 工程总时长：积木出点 / 配音时长 / 场景出点取最大，最少 6 秒 */
export function projectDuration(doc: Pick<ProjectSnapshot, 'blocks' | 'narration' | 'scenes'>): number {
  const narrationEnd = doc.narration?.duration ?? 0;
  const sceneEnd = doc.scenes.reduce((max, scene) => Math.max(max, scene.end), 0);
  return Math.max(compositionDuration(doc.blocks), narrationEnd, sceneEnd, 6);
}
