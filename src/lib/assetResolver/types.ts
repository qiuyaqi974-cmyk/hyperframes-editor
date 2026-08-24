export interface AssetResolveRequest {
  scenePlan: any;
  assets: any[];
  assetInsights: any[];
}

export interface AssetResolveResult {
  scenePlan: any;
  matchedCount: number;
  unmatchedCount: number;
}
