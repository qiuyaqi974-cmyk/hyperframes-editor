export type SceneBlueprintStage = 'Hook' | 'Development' | 'Proof' | 'CTA';

export interface SceneBlueprintScene {
  id: string;
  duration: number;
  purpose: string;
  informationGoal: string;
  emotion: string;
  visualType: string;
  subtitleRule: string;
  assetRequirement: string;
}

export interface SceneBlueprint {
  id: string;
  templateType: string;
  scenes: SceneBlueprintScene[];
}
