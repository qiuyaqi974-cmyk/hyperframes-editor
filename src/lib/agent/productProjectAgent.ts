import { scanLocalAssets } from '@/lib/agent/localAssetScanner';
import { generateProductVideoPlan, type ProductVideoInput } from '@/lib/agent/productVideoAgent';
import { scenePlanToSnapshot } from '@/lib/agent/scenePlan';
import type { LLMProvider } from '@/lib/agent/llmProvider';
import type { ProjectSnapshot } from '@/types';

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
  snapshot: ProjectSnapshot;
}

/** Node/Electron 侧的完整商品工程编排入口。 */
export async function generateProductProject(
  input: ProductProjectInput,
  provider?: LLMProvider,
  importSnapshot?: (snapshot: ProjectSnapshot) => void,
): Promise<ProductProjectResult> {
  const assets = await scanLocalAssets(input.folderPath);
  const videoInput: ProductVideoInput = {
    ...input.productInfo,
    duration: 30,
  };
  const plan = await generateProductVideoPlan(videoInput, provider);
  console.log('assets before scene:', assets);
  const snapshot = scenePlanToSnapshot(plan, assets);
  importSnapshot?.(snapshot);
  return { assets, snapshot };
}

export default generateProductProject;
