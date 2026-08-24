export interface ContentCase {
  id: string;
  title: string;
  author?: string;
  platform?: string;
  likes?: number;
  tags?: string[];
  script: string;
  hook?: string;
  emotion?: string;
  structure?: string;
  conflict?: string;
  personalNote?: string;
}

export interface ContentPattern {
  id: string;
  name: string;
  category: string;
  description: string;
  structure: string[];
  hookPatterns: string[];
  emotionalTriggers: string[];
  reusableRules: string[];
}
