import type { SceneBlockPlan, ScenePlan } from '@/lib/agent/scenePlan';

export interface ProductVideoInput {
  productName: string;
  targetAudience: string;
  sellingPoints: string[];
  duration: number;
}

function sceneBlocks(
  text: string,
  visualType: 'card' | 'image',
  visualContent: string,
  duration: number,
): SceneBlockPlan[] {
  return [
    { type: 'text', content: text, layoutPreset: 'top-title', duration },
    { type: 'voice', content: text, layoutPreset: 'center-product', duration },
    { type: 'subtitle', content: text, layoutPreset: 'bottom-subtitle', duration },
    { type: visualType, content: visualContent, layoutPreset: visualType === 'card' ? 'feature-card' : 'center-product', duration },
  ];
}

function allocateDurations(requested: number): [number, number, number, number] {
  // 四段结构至少需要 3 秒钩子 + 三段各 1 秒；不足时提升到可编辑的最小长度。
  const total = Math.max(6, Math.round(Number.isFinite(requested) ? requested : 15));
  const hook = 3;
  const remaining = total - hook;
  let product = Math.max(1, Math.round(remaining * 0.4));
  let benefits = Math.max(1, Math.round(remaining * 0.35));
  let cta = remaining - product - benefits;
  while (cta < 1 && product > 1) {
    product -= 1;
    cta += 1;
  }
  while (cta < 1 && benefits > 1) {
    benefits -= 1;
    cta += 1;
  }
  return [hook, product, benefits, Math.max(1, cta)];
}

/**
 * 商品视频 Agent 的本地 mock 实现。
 * 输出严格遵循 ScenePlan，未来可将函数内部替换为真实模型调用。
 */
export function generateProductVideoPlan(input: ProductVideoInput): ScenePlan {
  const productName = input.productName.trim();
  const targetAudience = input.targetAudience.trim() || '想要提升生活效率的人';
  const sellingPoints = (input.sellingPoints ?? []).map((point) => point.trim()).filter(Boolean);
  if (!productName) throw new Error('商品名称不能为空。');

  const points = sellingPoints.length > 0 ? sellingPoints : ['核心卖点待补充'];
  const [hookDuration, productDuration, benefitDuration, ctaDuration] = allocateDurations(input.duration);
  const pointText = points.join('、');

  const hookText = `${productName}，为什么特别适合${targetAudience}？`;
  const productText = `这就是${productName}：为${targetAudience}设计的日常解决方案。`;
  const benefitText = `它的关键优势是：${pointText}。`;
  const ctaText = `如果你正在寻找${productName}，现在就把它加入你的选择清单。`;

  return {
    projectName: `${productName} · 商品视频`,
    canvas: { width: 1920, height: 1080 },
    scenes: [
      {
        id: 'hook',
        duration: hookDuration,
        blocks: sceneBlocks(hookText, 'card', `目标人群：${targetAudience}`, hookDuration),
      },
      {
        id: 'product',
        duration: productDuration,
        blocks: sceneBlocks(productText, 'image', `${productName} 产品图占位`, productDuration),
      },
      {
        id: 'benefits',
        duration: benefitDuration,
        blocks: sceneBlocks(benefitText, 'card', points[0], benefitDuration),
      },
      {
        id: 'cta',
        duration: ctaDuration,
        blocks: sceneBlocks(ctaText, 'card', '立即了解 · 购买引导占位', ctaDuration),
      },
    ],
  };
}
