import type { ScenePlan } from '@/lib/agent/scenePlan';
import type { DirectorPlan } from './types';

const DURATIONS = [5, 20, 20, 10];

/** 将导演方案转换为 ScenePlan；这里只生成占位积木，不做素材匹配或媒体生成。 */
export function directorPlanToScenePlan(plan: DirectorPlan): ScenePlan {
  const scenes = (plan.scenes ?? []).map((scene, index) => {
    const isCta = index === 3;
    const blocks: ScenePlan['scenes'][number]['blocks'] = [
      { type: 'voice', content: scene.scriptDirection, duration: DURATIONS[index] ?? 15 },
      { type: 'subtitle', content: scene.subtitleDirection, duration: DURATIONS[index] ?? 15 },
    ];
    if (!isCta) {
      blocks.push({
        type: 'image',
        content: index === 0 ? '开场画面占位' : index === 2 ? '案例/演示画面占位' : '辅助画面占位',
        visualPrompt: scene.visualDirection,
        duration: DURATIONS[index] ?? 15,
      });
    }
    return {
      id: `director-scene-${index + 1}`,
      duration: DURATIONS[index] ?? 15,
      blocks,
    };
  });
  return { projectName: 'DirectorPlan 导演方案工程', canvas: { width: 1920, height: 1080 }, scenes };
}

export default directorPlanToScenePlan;
