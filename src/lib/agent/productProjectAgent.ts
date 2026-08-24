import { scanLocalAssets } from '@/lib/agent/localAssetScanner';
import { analyzeAssets, type AssetInsight } from '@/lib/agent/assetAnalyzer';
import { generateProductVideoPlan, type ProductVideoInput } from '@/lib/agent/productVideoAgent';
import { scenePlanToSnapshot } from '@/lib/agent/scenePlan';
import type { LLMProvider } from '@/lib/agent/llmProvider';
import type { ProjectSnapshot } from '@/types';
// @ts-expect-error Node-only output writer; this module is executed by Electron/Node.
import { writeFile } from 'node:fs/promises';
// @ts-expect-error Node-only path helper; this module is executed by Electron/Node.
import { join } from 'node:path';

export interface ProductProjectInput {
  folderPath: string;
  productInfo: {
    productName: string;
    targetAudience: string;
    sellingPoints: string[];
  };
}

export interface ProductProjectResult {
  assets: Awaited<ReturnType<typeof scanLocalAssets>>;
  assetInsights: AssetInsight[];
  snapshot: ProjectSnapshot;
  scenePlanPath: string;
}

/** Node/Electron 侧的完整商品工程编排入口。 */
export async function generateProductProject(
  input: ProductProjectInput,
  provider?: LLMProvider,
  importSnapshot?: (snapshot: ProjectSnapshot) => void,
): Promise<ProductProjectResult> {
  const assets = await scanLocalAssets(input.folderPath);
  const assetInsights = analyzeAssets(assets);
  const videoInput: ProductVideoInput = {
    ...input.productInfo,
    duration: 30,
    assetInsights,
  };
  const plan = await generateProductVideoPlan(videoInput, provider);
  console.log('assets before scene:', assets);
  const sceneLabels: Record<string, string> = {
    hook: '开场痛点',
    product: '产品展示',
    benefits: '卖点证明',
    cta: '购买引导',
  };
  const generatedScenePlan = {
    scenes: plan.scenes.flatMap((scene) => scene.blocks
      .filter((block) => block.type === 'image' && block.assetId)
      .map((block) => ({
        scene: sceneLabels[scene.id] ?? scene.id,
        assetId: assets.find((asset) => asset.id === block.assetId)?.name ?? block.assetId,
      }))),
  };
  const scenePlanPath = join(input.folderPath, 'generated-scene-plan.json');
  await writeFile(scenePlanPath, JSON.stringify(generatedScenePlan, null, 2), 'utf8');
  console.log('generated scene plan:', scenePlanPath);
  const snapshot = scenePlanToSnapshot(plan, assets);
  importSnapshot?.(snapshot);
  return { assets, assetInsights, snapshot, scenePlanPath };
}

export default generateProductProject;
