import type { SceneBlueprint } from '@/lib/sceneBlueprint/types';
import type { DirectorPlan, DirectorRequest } from './types';

function isProductBlueprint(blueprint: SceneBlueprint): boolean {
  return /商品|产品|带货|消费/.test(blueprint.templateType);
}

function chooseBlueprint(request: DirectorRequest, blueprints: SceneBlueprint[]): SceneBlueprint | undefined {
  const product = request.contentType.toLowerCase() === 'product' || /商品|产品|带货/.test(request.contentType);
  const candidates = blueprints.filter((blueprint) => isProductBlueprint(blueprint) === product);
  return candidates[0] || blueprints[0];
}

function scriptDirection(stage: number, request: DirectorRequest, scene: SceneBlueprint['scenes'][number]): string {
  const audience = request.audience ? `，只对“${request.audience}”说` : '';
  const tone = request.tone ? `语气保持${request.tone}` : '';
  if (stage === 0) return `围绕“${request.topic}”提出一个反常识问题或痛点${audience}，用一句话制造冲突。${tone}`;
  if (stage === 1) return `解释“${request.topic}”的核心表达，围绕${scene.informationGoal}逐步展开。${tone}`;
  if (stage === 2) return `为“${request.topic}”加入真实案例、数据或操作演示，证明前面的观点。情绪走向：${request.emotionArc || '从疑问走向确信'}。`;
  return `引导观众“${request.endingAction || request.goal || '采取下一步行动'}”，动作清晰且门槛低。`;
}

/** 基于 Scene Blueprint 生成可供后续写稿使用的导演方案，不调用模型。 */
export function generateDirectorPlan(request: DirectorRequest, blueprints: SceneBlueprint[] | unknown): DirectorPlan {
  const list = Array.isArray(blueprints) ? blueprints : [];
  const selected = chooseBlueprint(request, list);
  if (!selected) return { templateId: '', scenes: [] };
  return {
    templateId: selected.id,
    scenes: selected.scenes.map((scene, index) => ({
      purpose: scene.purpose,
      scriptDirection: scriptDirection(index, request, scene),
      visualDirection: `${scene.visualType}；素材需求：${scene.assetRequirement}${request.visualRules ? `；全局视觉原则：${request.visualRules}` : ''}`,
      subtitleDirection: scene.subtitleRule,
    })),
  };
}

export default generateDirectorPlan;
