import type { AssetResolveRequest, AssetResolveResult } from './types';

const KEYWORDS: Record<string, string[]> = {
  展示: ['展示', '正面', '外观', '图片', '照片'],
  演示: ['演示', '操作', '过程', '使用', '效果', '视频'],
  案例: ['案例', '截图', '数据', '前后对比'],
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[\s_\-]+/g, '');
}

function requirement(block: Record<string, any>): string {
  return text(block.assetHint) || text(block.assetRequirement) || text(block.visualNeed) || text(block.visualPrompt) || text(block.content);
}

function assetName(asset: Record<string, any>): string {
  return text(asset.name) || text(asset.url) || text(asset.path);
}

function scoreAsset(need: string, asset: Record<string, any>, insight: Record<string, any> | undefined): number {
  const name = assetName(asset);
  const target = normalized(need);
  const candidate = normalized(name);
  if (target && candidate && (candidate.includes(target) || target.includes(candidate))) return 1;
  const tokens = Object.entries(KEYWORDS)
    .filter(([category, keywords]) => need.includes(category) || keywords.some((keyword) => need.includes(keyword)))
    .flatMap(([, keywords]) => keywords);
  const insightKeywords = (Array.isArray(insight?.keywords) ? insight.keywords : []).map(text).filter(Boolean);
  const nameHaystack = `${name} ${text(insight?.name)}`;
  const nameScore = tokens.length ? tokens.filter((keyword) => nameHaystack.includes(keyword)).length / tokens.length : 0;
  const insightScore = insightKeywords.length
    ? insightKeywords.filter((keyword) => need.includes(keyword) || nameHaystack.includes(keyword)).length / insightKeywords.length
    : 0;
  return Math.max(nameScore, insightScore * 0.9);
}

/** 根据导演需求和素材理解结果做规则匹配，不调用模型或视觉识别。 */
export function resolveAssets(request: AssetResolveRequest): AssetResolveResult {
  const scenePlan = structuredClone(request.scenePlan);
  const assets = Array.isArray(request.assets) ? request.assets : [];
  const insights = Array.isArray(request.assetInsights) ? request.assetInsights : [];
  const insightById = new Map(insights.map((item) => [text(item.assetId), item]));
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const scene of Array.isArray(scenePlan?.scenes) ? scenePlan.scenes : []) {
    for (const block of Array.isArray(scene.blocks) ? scene.blocks : []) {
      if (block.type !== 'image' && block.type !== 'video') continue;
      const need = requirement(block);
      const hint = text(block.assetHint);
      const ranked = assets
        .map((asset) => ({ asset, score: scoreAsset(need || hint, asset, insightById.get(text(asset.id))) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      const matched = best && best.score > 0 ? best.asset : null;
      if (matched) {
        block.assetId = text(matched.id) || null;
        matchedCount += 1;
      } else {
        block.assetId = null;
        unmatchedCount += 1;
      }
      console.log('[asset resolver]', { scene: scene.id, requirement: need, matched: matched ? assetName(matched) : 'none', confidence: matched ? Number(best.score.toFixed(2)) : 0 });
    }
  }
  return { scenePlan, matchedCount, unmatchedCount };
}

export default resolveAssets;
