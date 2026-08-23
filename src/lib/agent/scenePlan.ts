import {
  CANVAS_DEFAULT,
  createCardBlock,
  createImageBlock,
  createSubtitleBlock,
  createTextBlock,
  createVoiceBlock,
} from '@/lib/blockFactory';
import { getLayoutPosition } from '@/lib/layout/layoutPreset';
import type { LayoutPreset } from '@/lib/layout/layoutPreset';
import type { Block, ProjectSnapshot } from '@/types';

export type SceneBlockType = 'text' | 'voice' | 'subtitle' | 'card' | 'image';

export interface SceneBlockPlan {
  type: SceneBlockType;
  content: string;
  /** 用于后续生成或检索视觉素材的描述；旧工程可以省略。 */
  visualPrompt?: string;
  layoutPreset?: LayoutPreset;
  duration: number;
}

export interface ScenePlan {
  projectName: string;
  canvas?: {
    width: number;
    height: number;
  };
  scenes: {
    id: string;
    duration: number;
    blocks: SceneBlockPlan[];
  }[];
}

function makeBlock(
  plan: SceneBlockPlan,
  canvas: typeof CANVAS_DEFAULT,
  layer: number,
  start: number,
): Block {
  const duration = Math.max(0.1, plan.duration);
  let block: Block;

  if (plan.type === 'text') {
    block = createTextBlock(canvas, layer, start);
    block.props.text = plan.content;
  } else if (plan.type === 'voice') {
    block = createVoiceBlock(canvas, layer, start);
    block.props.text = plan.content;
    block.props.src = null;
    block.props.duration = 0;
    block.props.generated = false;
  } else if (plan.type === 'subtitle') {
    block = createSubtitleBlock(canvas, layer, start);
    block.props.text = plan.content;
  } else if (plan.type === 'card') {
    block = createCardBlock(canvas, layer, start);
    block.props.title = plan.content;
    block.props.body = '';
  } else {
    block = createImageBlock(null, canvas, layer, start);
    block.name = plan.content || '图片占位';
  }

  block.duration = duration;
  if (plan.layoutPreset) {
    block.layoutPreset = plan.layoutPreset;
    block.position = getLayoutPosition(plan.layoutPreset);
  }
  return block;
}

/** 将 Agent 输出的场景协议转换成 HyperFrames 可直接导入的工程快照。 */
export function scenePlanToSnapshot(plan: ScenePlan): ProjectSnapshot {
  const canvas = {
    ...CANVAS_DEFAULT,
    ...(plan.canvas ?? {}),
  };
  const blocks: Block[] = [];
  const scenes: ProjectSnapshot['scenes'] = [];
  let elapsed = 0;
  let layer = 0;

  for (const [index, scenePlan] of plan.scenes.entries()) {
    const sceneDuration = Math.max(0.1, scenePlan.duration);
    const sceneStart = elapsed;
    const sceneBlocks = scenePlan.blocks.map((blockPlan) =>
      makeBlock(blockPlan, canvas, layer++, sceneStart),
    );
    blocks.push(...sceneBlocks);
    scenes.push({
      id: scenePlan.id || `scene_${index + 1}`,
      index: index + 1,
      start: sceneStart,
      end: sceneStart + sceneDuration,
      duration: sceneDuration,
      text: scenePlan.blocks.map((block) => block.content).filter(Boolean).join(' '),
    });
    elapsed += sceneDuration;
  }

  return {
    app: 'hyperframes-editor',
    version: 4,
    themeId: 'midnight',
    projectName: plan.projectName || '未命名场景工程',
    canvas,
    blocks,
    assets: [],
    narration: null,
    scenes,
    updatedAt: new Date().toISOString(),
  };
}
