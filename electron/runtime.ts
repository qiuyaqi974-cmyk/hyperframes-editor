import { generateProductProject } from '../src/lib/agent/productProjectAgent';
import { ZhipuProvider } from '../src/lib/agent/providers/zhipuProvider';

export interface ProductProjectRequest {
  folderPath: string;
  productInfo: {
    productName: string;
    targetAudience: string;
    sellingPoints: string[];
  };
}

export async function runProductProject(input: ProductProjectRequest) {
  return generateProductProject(input, new ZhipuProvider());
}
