import { generateProductProject } from '../src/lib/agent/productProjectAgent';
import { ZhipuProvider } from '../src/lib/agent/providers/zhipuProvider';
import type { DirectorDecision } from '../src/types';

export interface ProductProjectRequest {
  folderPath: string;
  productInfo: {
    productName: string;
    targetAudience: string;
    sellingPoints: string[];
  };
  director?: DirectorDecision;
}

export async function runProductProject(input: ProductProjectRequest) {
  return generateProductProject(input, new ZhipuProvider());
}
