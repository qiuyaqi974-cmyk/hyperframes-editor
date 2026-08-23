import type { Asset } from '@/types';

export interface AssetInsight {
  assetId: string;
  name: string;
  kind: Asset['kind'];
  usage: string;
  recommendedScene: string[];
  keywords: string[];
}

const RULES: Array<{ words: string[]; usage: string; scenes: string[]; keywords: string[] }> = [
  { words: ['正面', '商品', '产品'], usage: '商品主体展示', scenes: ['开头展示', '产品介绍'], keywords: ['商品', '产品', '外观'] },
  { words: ['使用', '展示', '冲洗', '操作', '过程'], usage: '使用场景', scenes: ['使用演示', '卖点说明'], keywords: ['使用', '操作', '过程'] },
  { words: ['参数', '规格', '尺寸'], usage: '参数说明', scenes: ['卖点证明', '参数介绍'], keywords: ['参数', '规格', '尺寸'] },
  { words: ['视频', '展示', '效果'], usage: '功能演示', scenes: ['功能演示', '购买引导'], keywords: ['功能', '效果', '演示'] },
];

export function analyzeAssets(assets: Asset[]): AssetInsight[] {
  const insights = assets.map((asset) => {
    const name = asset.name.toLowerCase();
    const matched = RULES.filter((rule) => rule.words.some((word) => name.includes(word)));
    const scenes = [...new Set(matched.flatMap((rule) => rule.scenes))];
    return {
      assetId: asset.id,
      name: asset.name,
      kind: asset.kind,
      usage: matched[0]?.usage ?? (asset.kind === 'video' ? '视频素材' : '通用图片素材'),
      recommendedScene: scenes.length ? scenes : ['场景补充'],
      keywords: [...new Set(matched.flatMap((rule) => rule.keywords))],
    };
  });
  console.log('素材分析结果：', insights);
  return insights;
}

export default analyzeAssets;
