import type { SourceTranscriptSegment, SourceTranscriptionMeta } from '@/types';

export interface SourceTranscriptionCapabilities {
  available: boolean;
  version?: string;
  python?: string;
  cuda?: boolean;
  deviceName?: string;
  models: string[];
  error?: string;
}

export interface SourceTranscriptionResult {
  sourceId: string;
  jobId: string;
  segments: SourceTranscriptSegment[];
  meta: SourceTranscriptionMeta;
}

export interface SourceTranscriptionProgress {
  sourceId: string;
  jobId: string;
  percent: number;
  phase: 'queued' | 'loading-model' | 'transcribing';
  segments?: number;
}

export interface SourceTranscriptionFailure {
  sourceId: string;
  jobId: string;
  canceled?: boolean;
  error: string;
}

export function transcriptSelectionRange(segment: SourceTranscriptSegment, duration: number) {
  const timedWords = segment.words?.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end)) ?? [];
  const rawStart = timedWords[0]?.start ?? segment.start;
  const rawEnd = timedWords[timedWords.length - 1]?.end ?? segment.end;
  const padding = timedWords.length ? 0.08 : 0.3;
  return {
    start: Math.max(0, rawStart - padding),
    end: Math.min(duration, rawEnd + padding),
  };
}
