import type { Asset } from '@/types';

export interface AssetMatchResult {
  assetId: string | null;
  confidence: number;
  reason: string;
}

type TaggedAsset = Asset & { tags?: string[]; label?: string };

function keywords(value: string): string[] {
  const normalized = value.toLowerCase().replace(/产品/g, '商品').replace(/图片|照片/g, '图');
  const words = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9]+/giu) ?? [];
  const bigrams = words
    .filter((word) => /^[\p{Script=Han}]+$/u.test(word) && word.length > 2)
    .flatMap((word) => Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2)));
  return [...new Set([...words, ...bigrams])];
}

/** 基于素材名称、可选标签和视觉提示词的轻量匹配器，不调用视觉模型。 */
export function matchAsset(visualPrompt: string, assets: Asset[], usedAssetIds: string[] = [], content = ''): AssetMatchResult {
  const promptKeywords = [...new Set([...keywords(content), ...keywords(visualPrompt)])];
  const imageAssets = assets.filter((asset) => asset.kind === 'image') as TaggedAsset[];
  if (!imageAssets.length) return { assetId: null, confidence: 0, reason: '没有可用的图片素材。' };

  let best: { asset: TaggedAsset; score: number; hits: string[] } | null = null;
  for (const tagged of imageAssets) {
    if (usedAssetIds.includes(tagged.id)) continue;
    const searchable = [tagged.name, ...(tagged.tags ?? []), tagged.label ?? ''].join(' ');
    const assetKeywords = keywords(searchable);
    const hits = promptKeywords.filter((keyword) => assetKeywords.some((candidate) => candidate.includes(keyword) || keyword.includes(candidate)));
    const score = promptKeywords.length ? hits.length / promptKeywords.length : 0;
    if (!best || score > best.score) best = { asset: tagged, score, hits: [...new Set(hits)] };
  }

  if (!best || best.score <= 0) {
    const next = imageAssets.find((asset) => !usedAssetIds.includes(asset.id)) ?? imageAssets[usedAssetIds.length % imageAssets.length];
    if (!next) return { assetId: null, confidence: 0, reason: '没有找到可轮询的图片素材。' };
    return { assetId: next.id, confidence: 0.2, reason: '未命中关键词，按素材库顺序轮询。' };
  }
  return {
    assetId: best.asset.id,
    confidence: Math.min(1, Number(best.score.toFixed(2))),
    reason: `匹配文件名/关键词：${best.hits.join('、')}`,
  };
}

export default matchAsset;
