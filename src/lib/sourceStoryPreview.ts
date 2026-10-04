import type { NarrativeRole } from '@/types';

export interface SourceStoryPreviewSegment {
  sourcePath: string;
  sourceName: string;
  start: number;
  end: number;
  narrativeRole: NarrativeRole;
}

export interface SourceStoryPreviewRequest {
  jobId: string;
  structureFingerprint: string;
  segments: SourceStoryPreviewSegment[];
}

export interface SourceStoryPreviewProgress {
  jobId: string;
  percent: number;
  phase: 'extracting' | 'joining' | 'verifying';
  segmentIndex?: number;
  segmentCount: number;
}

export interface SourceStoryPreviewResult {
  jobId: string;
  path: string;
  duration: number;
  cached: boolean;
  structureFingerprint: string;
  boundaries: Array<{ outputTime: number; beforeIndex: number; afterIndex: number }>;
}
