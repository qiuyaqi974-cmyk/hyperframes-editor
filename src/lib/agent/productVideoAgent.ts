import type { LLMProvider } from '@/lib/agent/llmProvider';
import { MockProvider } from '@/lib/agent/llmProvider';
import type { SceneBlockPlan, ScenePlan } from '@/lib/agent/scenePlan';

export interface ProductVideoInput {
  productName: string;
  targetAudience: string;
  sellingPoints: string[];
  duration: number;
}

function sceneBlocks(text: string, visualType: 'card' | 'image', visualContent: string, duration: number): SceneBlockPlan[] {
  return [
    { type: 'text', content: text, layoutPreset: 'top-title', duration },
    { type: 'voice', content: text, layoutPreset: 'center-product', duration },
    { type: 'subtitle', content: text, layoutPreset: 'bottom-subtitle', duration },
    { type: visualType, content: visualContent, layoutPreset: visualType === 'card' ? 'feature-card' : 'center-product', duration },
  ];
}

function allocateDurations(requested: number): [number, number, number, number] {
  const total = Math.max(6, Math.round(Number.isFinite(requested) ? requested : 15));
  const hook = 3;
  const remaining = total - hook;
  let product = Math.max(1, Math.round(remaining * 0.4));
  let benefits = Math.max(1, Math.round(remaining * 0.35));
  let cta = remaining - product - benefits;
  while (cta < 1 && product > 1) { product -= 1; cta += 1; }
  while (cta < 1 && benefits > 1) { benefits -= 1; cta += 1; }
  return [hook, product, benefits, Math.max(1, cta)];
}

function buildMockScenePlan(input: ProductVideoInput): ScenePlan {
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
      { id: 'hook', duration: hookDuration, blocks: sceneBlocks(hookText, 'card', `目标人群：${targetAudience}`, hookDuration) },
      { id: 'product', duration: productDuration, blocks: sceneBlocks(productText, 'image', `${productName} 产品图占位`, productDuration) },
      { id: 'benefits', duration: benefitDuration, blocks: sceneBlocks(benefitText, 'card', points[0], benefitDuration) },
      { id: 'cta', duration: ctaDuration, blocks: sceneBlocks(ctaText, 'card', '立即了解 · 购买引导占位', ctaDuration) },
    ],
  };
}

function buildPrompt(input: ProductVideoInput): string {
  return [
    '你是商品短视频策划器。请只返回符合 ScenePlan 的 JSON，不要 Markdown，不要解释。',
    '必须包含 hook、product、benefits、cta 四个场景；每个场景必须有 text、voice、subtitle 和 card/image 占位，并保留 layoutPreset。',
    `INPUT_JSON:\n${JSON.stringify(input)}`,
  ].join('\n');
}

function validateScenePlan(value: unknown): asserts value is ScenePlan {
  if (!value || typeof value !== 'object' || !Array.isArray((value as ScenePlan).scenes)) throw new Error('商品视频 Agent 返回的 JSON 不是有效 ScenePlan。');
  const plan = value as ScenePlan;
  if (typeof plan.projectName !== 'string' || plan.scenes.length === 0) throw new Error('商品视频 Agent 返回的 ScenePlan 缺少项目名或场景。');
  for (const scene of plan.scenes) {
    if (!scene || typeof scene.id !== 'string' || !Number.isFinite(scene.duration) || !Array.isArray(scene.blocks)) throw new Error('商品视频 Agent 返回的场景结构无效。');
    for (const block of scene.blocks) {
      if (!block || !['text', 'voice', 'subtitle', 'card', 'image'].includes(block.type) || typeof block.content !== 'string' || !Number.isFinite(block.duration)) throw new Error('商品视频 Agent 返回的场景积木结构无效。');
    }
  }
}

/** 商品视频 Agent：Prompt → LLMProvider → JSON → ScenePlan。 */
export async function generateProductVideoPlan(input: ProductVideoInput, provider?: LLMProvider): Promise<ScenePlan> {
  const fallback = buildMockScenePlan(input);
  const llm = provider ?? new MockProvider(JSON.stringify(fallback));
  const raw = await llm.generate(buildPrompt(input));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('商品视频 Agent 返回的内容不是有效 JSON，请检查模型输出。');
  }
  validateScenePlan(parsed);
  return parsed;
}
