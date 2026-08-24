export interface CleanedContentCase {
  id: string;
  creator: string | null;
  title: string | null;
  script: string | null;
  metrics: {
    likes: number | null;
    comments: number | null;
    shares: number | null;
    views: number | null;
  };
  tags: string[];
  hook: string | null;
  emotion: string | null;
  structure: string | null;
  conflict: string | null;
  personalNote: string | null;
  isAdvertisement: boolean;
  adType: 'pure' | 'soft' | null;
  usable: boolean;
}

export interface CleaningStats {
  total: number;
  usable: number;
  advertisements: number;
  missing: Record<string, number>;
}
