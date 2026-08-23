import type { Asset } from '@/types';

export interface AssetMatchResult {
  assetId: string | null;
  confidence: number;
  reason: string;
}

type TaggedAsset = Asset & { tags?: string[]; label?: string };

function keywords(value: string): string[] {
  const normalized = value.toLowerCase();
  const words = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9]+/giu) ?? [];
  const bigrams = words
    .filter((word) => /^[\p{Script=Han}]+$/u.test(word) && word.length > 2)
    .flatMap((word) => Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2)));
  return [...new Set([...words, ...bigrams])];
}

/** 基于素材名称、可选标签和视觉提示词的轻量匹配器，不调用视觉模型。 */
export function matchAsset(visualPrompt: string, assets: Asset[]): AssetMatchResult {
  const promptKeywords = keywords(visualPrompt);
  if (!promptKeywords.length || !assets.length) return { assetId: null, confidence: 0, reason: '没有可用的视觉关键词或素材。' };

  let best: { asset: TaggedAsset; score: number; hits: string[] } | null = null;
  for (const asset of assets) {
    if (asset.kind !== 'image') continue;
    const tagged = asset as TaggedAsset;
    const searchable = [tagged.name, ...(tagged.tags ?? []), tagged.label ?? ''].join(' ');
    const assetKeywords = keywords(searchable);
    const hits = promptKeywords.filter((keyword) => assetKeywords.some((candidate) => candidate.includes(keyword) || keyword.includes(candidate)));
    const score = hits.length / promptKeywords.length;
    if (!best || score > best.score) best = { asset: tagged, score, hits: [...new Set(hits)] };
  }

  if (!best || best.score <= 0) return { assetId: null, confidence: 0, reason: '没有找到名称或标签匹配的图片素材。' };
  return {
    assetId: best.asset.id,
    confidence: Math.min(1, Number(best.score.toFixed(2))),
    reason: `匹配关键词：${best.hits.join('、')}`,
  };
}

export default matchAsset;
