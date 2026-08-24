import type { DirectorTemplateV2 } from '@/lib/contentDirector/types';
import type { SceneBlueprint, SceneBlueprintScene, SceneBlueprintStage } from './types';

interface StageConfig {
  purpose: string;
  informationGoal: string;
  emotion: string;
  visualType: string;
  assetRequirement: string;
}

const STAGES: SceneBlueprintStage[] = ['Hook', 'Development', 'Proof', 'CTA'];

function isProductTemplate(template: DirectorTemplateV2): boolean {
  const text = [template.name, template.applicableContent?.join(' '), template.goal].join(' ');
  return /商品|产品|带货|消费/.test(text);
}

function stageConfig(stage: SceneBlueprintStage, template: DirectorTemplateV2): StageConfig {
  const product = isProductTemplate(template);
  const configs: Record<SceneBlueprintStage, StageConfig> = product
    ? {
        Hook: { purpose: '提出用户痛点', informationGoal: '让观众意识到一个具体需求', emotion: '共鸣与好奇', visualType: '痛点场景或结果先行', assetRequirement: '痛点场景素材或产品结果画面' },
        Development: { purpose: '展示产品', informationGoal: '说明产品如何解决需求', emotion: '理解与信任', visualType: '产品主体展示与使用过程', assetRequirement: '产品图、使用图或产品视频' },
        Proof: { purpose: '证明功能', informationGoal: '用事实、演示或对比支撑卖点', emotion: '确信与获得感', visualType: '功能演示、细节特写或前后对比', assetRequirement: '功能演示、参数图或效果素材' },
        CTA: { purpose: '给出购买理由', informationGoal: '降低决策成本并推动下一步行动', emotion: '行动欲与确定感', visualType: '产品总结、优惠信息或行动提示', assetRequirement: '产品主视觉、价格/权益卡片或品牌素材' },
      }
    : {
        Hook: { purpose: '制造认知冲突', informationGoal: '提出问题、反差或结果，抓住注意力', emotion: '好奇与惊讶', visualType: '真人口播、问题大字或结果先行', assetRequirement: '钩子画面、截图或案例封面' },
        Development: { purpose: '解释核心原理', informationGoal: '拆解问题背景与关键逻辑', emotion: '理解与代入', visualType: '真人讲解配合步骤、图示或场景', assetRequirement: '讲解截图、过程画面或示意素材' },
        Proof: { purpose: '展示案例或演示', informationGoal: '用实例验证观点并建立可信度', emotion: '信任与获得感', visualType: '案例、前后对比或操作演示', assetRequirement: '案例图片、数据截图或演示视频' },
        CTA: { purpose: '给出行动建议', informationGoal: '把认知转化为观众下一步行动', emotion: '确定感与行动欲', visualType: '总结金句、步骤清单或口播收束', assetRequirement: '总结卡片、步骤截图或行动提示' },
      };
  return configs[stage];
}

function durationForStage(stage: SceneBlueprintStage): number {
  return stage === 'Hook' ? 5 : stage === 'CTA' ? 10 : 20;
}

/** 将导演模板转换成独立的四段式场景蓝图，不创建或修改 HyperFrames Block。 */
export function generateSceneBlueprints(input: DirectorTemplateV2[] | unknown): SceneBlueprint[] {
  if (!Array.isArray(input)) return [];
  return input.map((template, index) => {
    const safe = template as DirectorTemplateV2;
    const scenes: SceneBlueprintScene[] = STAGES.map((stage) => {
      const config = stageConfig(stage, safe);
      return {
        id: `${safe.id || `template-${index + 1}`}-${stage.toLowerCase()}`,
        duration: durationForStage(stage),
        purpose: config.purpose,
        informationGoal: config.informationGoal,
        emotion: safe.timeline?.[stage === 'Hook' ? 0 : stage === 'CTA' ? safe.timeline.length - 1 : 1]?.emotion || config.emotion,
        visualType: config.visualType,
        subtitleRule: safe.timeline?.[stage === 'Hook' ? 0 : stage === 'CTA' ? safe.timeline.length - 1 : 1]?.subtitleStyle || '重点词放大，按信息分段显示',
        assetRequirement: config.assetRequirement,
      };
    });
    return { id: `blueprint-${safe.id || index + 1}`, templateType: safe.name || safe.id || `模板${index + 1}`, scenes };
  });
}

export default generateSceneBlueprints;
