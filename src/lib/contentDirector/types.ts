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
