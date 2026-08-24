export interface DirectorTemplate {
  id: string;
  name: string;
  sourcePattern: string;
  contentType: string;
  structure: string[];
  hook: { rule: string; examples: string[] };
  middle: { rule: string };
  ending: { rule: string };
  emotionalTrigger: string;
  visualStrategy: { camera: string; subtitle: string; scene: string };
  applicableTopics: string[];
}

export interface DirectorTimelineStep {
  duration: number;
  purpose: string;
  emotion: string;
  contentAction: string;
  visualNeed: string;
  subtitleStyle: string;
}

export interface DirectorTemplateV2 {
  id: string;
  name: string;
  applicableContent: string[];
  audience: string;
  goal: string;
  timeline: DirectorTimelineStep[];
  hookRule: string;
  middleRule: string;
  endingRule: string;
}
