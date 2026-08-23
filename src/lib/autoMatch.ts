import type { Asset, Scene } from '@/types';

function normalize(value: string) {
  return value.toLowerCase().replace(/\.[^.]+$/, '').replace(/[\s_\-—–·，。！？、【】()[\]{}]+/g, '');
}

function keywords(value: string) {
  const clean = normalize(value);
  const chunks = value.toLowerCase().replace(/\.[^.]+$/, '').split(/[\s_\-—–·，。！？、【】()[\]{}]+/).filter((s) => s.length >= 2);
  const grams: string[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) grams.push(clean.slice(i, i + 2));
  return [...new Set([...chunks, ...grams])];
}

export function matchAssetsToScenes(assets: Asset[], scenes: Scene[]) {
  const available = new Set(assets.map((a) => a.id));
  const matches: { asset: Asset; scene: Scene; score: number }[] = [];
  for (const scene of scenes) {
    const sceneClean = normalize(scene.text);
    let best: { asset: Asset; score: number } | null = null;
    for (const asset of assets) {
      if (!available.has(asset.id)) continue;
      const stem = normalize(asset.name);
      let score = stem.length >= 2 && sceneClean.includes(stem) ? 100 + stem.length : 0;
      for (const token of keywords(asset.name)) if (sceneClean.includes(token)) score += token.length >= 3 ? 12 : 4;
      if (!best || score > best.score) best = { asset, score };
    }
    if (best && best.score >= 8) {
      matches.push({ asset: best.asset, scene, score: best.score });
      available.delete(best.asset.id);
    }
  }
  return {
    matches,
    unusedAssets: assets.filter((a) => available.has(a.id)),
    unmatchedScenes: scenes.filter((s) => !matches.some((m) => m.scene.id === s.id)),
  };
}
