export interface DirectorRequest {
  topic: string;
  goal: string;
  contentType: string;
  audience?: string;
  tone?: string;
  pacing?: string;
  emotionArc?: string;
  endingAction?: string;
  visualRules?: string;
}

export interface DirectorPlanScene {
  purpose: string;
  scriptDirection: string;
  visualDirection: string;
  subtitleDirection: string;
}

export interface DirectorPlan {
  templateId: string;
  scenes: DirectorPlanScene[];
}
