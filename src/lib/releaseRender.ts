import type { ReleaseCandidate } from '@/lib/releaseCandidate';

export interface ReleaseRenderRequest {
  html: string;
  candidateId: string;
  candidateLabel: string;
  projectName: string;
  candidateCreatedAt: string;
  snapshotUpdatedAt: string;
  directorUpdatedAt: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  health: ReleaseCandidate['health'];
  reviewSummary: { approved: number; pending: number; changes: number; redo: number; unresolvedComments: number };
}

export interface ReleaseRenderProgress {
  jobId: string;
  status: 'rendering';
  percent: number;
  frame: number;
  totalFrames: number;
}

export type ReleaseRenderResult =
  | { jobId: string; status: 'completed'; outputPath: string; reportPath: string; sha256: string }
  | { jobId: string; status: 'failed' | 'canceled'; error?: string };

export interface ReleaseRenderStatusSnapshot {
  jobId: string;
  candidateId?: string;
  candidateLabel?: string;
  status: 'idle' | 'rendering' | 'completed' | 'failed' | 'canceled';
  percent: number;
  outputPath?: string;
  reportPath?: string;
  sha256?: string;
  error?: string;
}

function durationOf(candidate: ReleaseCandidate) {
  const snapshot = candidate.snapshot;
  const blockEnd = snapshot.blocks.reduce((max, block) => Math.max(max, block.start + (block.type === 'voice' ? Math.max(block.duration, block.props.duration || 0) : block.duration)), 0);
  const sceneEnd = snapshot.scenes.reduce((max, scene) => Math.max(max, scene.end), 0);
  return Math.max(6, blockEnd, sceneEnd, snapshot.narration?.duration ?? 0);
}

export function createReleaseRenderRequest(candidate: ReleaseCandidate, html: string): ReleaseRenderRequest {
  const { snapshot } = candidate;
  const reviewSummary = { approved: 0, pending: 0, changes: 0, redo: 0, unresolvedComments: 0 };
  for (const scene of snapshot.scenes) {
    const review = snapshot.reviews?.[scene.id];
    const status = review?.status ?? 'pending';
    reviewSummary[status] += 1;
    reviewSummary.unresolvedComments += review?.comments.filter((comment) => !comment.resolved).length ?? 0;
  }
  return {
    html,
    candidateId: candidate.id,
    candidateLabel: candidate.label,
    projectName: candidate.projectName,
    candidateCreatedAt: candidate.createdAt,
    snapshotUpdatedAt: snapshot.updatedAt,
    directorUpdatedAt: snapshot.director?.updatedAt ?? '',
    width: snapshot.canvas.width,
    height: snapshot.canvas.height,
    fps: snapshot.canvas.fps,
    duration: durationOf(candidate),
    health: candidate.health,
    reviewSummary,
  };
}
