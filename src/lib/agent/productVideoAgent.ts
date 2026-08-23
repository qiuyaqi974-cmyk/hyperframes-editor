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
    '你是短视频带货视频策划 Agent。',
    '你的任务：根据商品信息生成 HyperFrames ScenePlan。',
    '只能返回 JSON。禁止输出 Markdown。禁止输出解释文字。',
    '',
    '严格格式（所有字段名必须保持一致）：',
    JSON.stringify({
      projectName: '视频名称',
      scenes: [{
        id: 'scene1',
        duration: 3,
        blocks: [
          { type: 'text', content: '标题文案', layoutPreset: 'top-title', duration: 3 },
          { type: 'voice', content: '旁白内容', layoutPreset: 'bottom-subtitle', duration: 3 },
          { type: 'subtitle', content: '字幕内容', layoutPreset: 'bottom-subtitle', duration: 3 },
          { type: 'card', content: '卖点信息', layoutPreset: 'feature-card', duration: 3 },
        ],
      }],
    }, null, 2),
    '',
    '规则：',
    '1. 总时长必须接近用户输入的 duration。',
    '2. 第一场景必须是 3 秒以内的强钩子。',
    '3. 每个 scene 只表达一个核心信息。',
    '4. 场景必须覆盖：用户痛点、产品展示、卖点证明、购买引导。',
    '5. blocks 的 type 只能使用：text、voice、subtitle、card、image。',
    '6. layoutPreset 只能使用：top-title、center-product、bottom-subtitle、feature-card、cta。',
    '7. 每个 block 必须包含 type、content、duration、layoutPreset。',
    '8. 返回前自行检查：scenes 存在；每个 scene 的 blocks 是数组；每个 type 都合法；最终内容是可解析的 JSON。',
    `INPUT_JSON:\n${JSON.stringify(input)}`,
  ].join('\n');
}

const sceneBlockTypes = ['text', 'voice', 'subtitle', 'card', 'image'] as const;
const layoutPresets = ['top-title', 'center-product', 'bottom-subtitle', 'feature-card', 'cta'] as const;

function normalizeScenePlan(value: unknown, input: ProductVideoInput): unknown {
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.scenes)) return value;
  const defaultDuration = Math.max(1, Math.round(input.duration / Math.max(1, source.scenes.length)));
  const scenes = source.scenes.map((rawScene, sceneIndex) => {
    const scene = rawScene && typeof rawScene === 'object' ? rawScene as Record<string, unknown> : {};
    const duration = typeof scene.duration === 'number' && Number.isFinite(scene.duration) && scene.duration > 0
      ? scene.duration
      : defaultDuration;
    const rawBlocks = Array.isArray(scene.blocks) ? scene.blocks : [];
    const blocks = rawBlocks.map((rawBlock) => {
      const block = rawBlock && typeof rawBlock === 'object' ? rawBlock as Record<string, unknown> : {};
      const type = sceneBlockTypes.includes(block.type as typeof sceneBlockTypes[number])
        ? block.type as typeof sceneBlockTypes[number]
        : 'text';
      const content = typeof block.content === 'string'
        ? block.content
        : typeof block.text === 'string' ? block.text : '';
      const layoutPreset = layoutPresets.includes(block.layoutPreset as typeof layoutPresets[number])
        ? block.layoutPreset
        : undefined;
      return {
        ...block,
        type,
        content,
        duration: typeof block.duration === 'number' && Number.isFinite(block.duration) && block.duration > 0
          ? block.duration
          : duration,
        ...(layoutPreset ? { layoutPreset } : {}),
      };
    });
    if (blocks.length === 0) {
      blocks.push({ type: 'text', content: typeof scene.text === 'string' ? scene.text : '', duration });
    }
    return { ...scene, id: typeof scene.id === 'string' && scene.id ? scene.id : `scene-${sceneIndex + 1}`, duration, blocks };
  });
  return {
    ...source,
    projectName: typeof source.projectName === 'string' && source.projectName ? source.projectName : `${input.productName} · 商品视频`,
    scenes,
  };
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
  console.log('LLM raw response:', raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('商品视频 Agent 返回的内容不是有效 JSON，请检查模型输出。');
  }
  parsed = normalizeScenePlan(parsed, input);
  validateScenePlan(parsed);
  return parsed;
}
