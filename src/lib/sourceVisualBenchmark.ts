import type { VisualIndexSample } from './sourceVisualIndex';
import type { VisualUnderstandingCandidate } from './sourceVisualUnderstanding';

export interface ChangeDetectionMetrics {
  expected: number;
  detected: number;
  matched: number;
  missed: number[];
  unexpected: number[];
  recall: number;
  precision: number;
  meanOffset: number | null;
}
export function evaluateChangeDetection(expected: number[], detected: number[], tolerance = 0.6): ChangeDetectionMetrics {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('匹配容差必须大于 0。');
  const remaining = detected.filter(Number.isFinite).sort((a, b) => a - b);
  const offsets: number[] = [];
  const missed: number[] = [];
  for (const target of expected.filter(Number.isFinite).sort((a, b) => a - b)) {
    let best = -1;
    let distance = Number.POSITIVE_INFINITY;
    remaining.forEach((value, index) => { const next = Math.abs(value - target); if (next < distance) { distance = next; best = index; } });
    if (best >= 0 && distance <= tolerance) offsets.push(distance), remaining.splice(best, 1);
    else missed.push(target);
  }
  const matched = offsets.length;
  return {
    expected: expected.length,
    detected: detected.length,
    matched,
    missed,
    unexpected: remaining,
    recall: expected.length ? matched / expected.length : 1,
    precision: detected.length ? matched / detected.length : expected.length ? 0 : 1,
    meanOffset: offsets.length ? offsets.reduce((sum, value) => sum + value, 0) / offsets.length : null,
  };
}

export function evaluateSampleCoverage(duration: number, samples: VisualIndexSample[], importantRanges: Array<{ start: number; end: number }> = []) {
  const times = samples.map((sample) => sample.time).filter(Number.isFinite).sort((a, b) => a - b);
  const points = [0, ...times, duration];
  const gaps = points.slice(1).map((value, index) => value - points[index]);
  return {
    samples: times.length,
    averageGap: gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : duration,
    maxGap: gaps.length ? Math.max(...gaps) : duration,
    coveredImportantRanges: importantRanges.filter((range) => times.some((time) => time >= range.start && time <= range.end)).length,
    importantRanges: importantRanges.length,
  };
}

const candidateFields = ['subject', 'action', 'object', 'result', 'shot', 'tags'] as const;

/** Compares a fixture candidate with human-authored ground truth. This never treats model self-evaluation as truth. */
export function evaluateCandidateCorrection(candidate: VisualUnderstandingCandidate, expected: VisualUnderstandingCandidate) {
  const complete = candidateFields.filter((field) => field === 'tags' ? candidate.tags.length > 0 : String(candidate[field]).trim().length > 0);
  const corrections = candidateFields.filter((field) => {
    if (field === 'tags') return [...candidate.tags].sort().join('|') !== [...expected.tags].sort().join('|');
    return candidate[field] !== expected[field];
  });
  return { completeFields: complete.length, totalFields: candidateFields.length, completeness: complete.length / candidateFields.length, corrections };
}
