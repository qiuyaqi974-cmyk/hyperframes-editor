import type { SceneReview, SceneReviewComment, SceneReviewStatus } from '@/types';

const STATUSES: SceneReviewStatus[] = ['pending', 'approved', 'changes', 'redo'];

export function emptySceneReview(sceneId: string): SceneReview {
  return { sceneId, status: 'pending', comments: [], updatedAt: '' };
}

function normalizeComment(value: unknown, index: number): SceneReviewComment | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<SceneReviewComment>;
  const text = String(input.text ?? '').trim();
  const time = Number(input.time);
  if (!text || !Number.isFinite(time)) return null;
  return {
    id: String(input.id ?? `review-comment-${index}`),
    time: Math.max(0, time),
    text,
    resolved: Boolean(input.resolved),
    createdAt: String(input.createdAt ?? ''),
  };
}

export function normalizeSceneReviews(value: unknown): Record<string, SceneReview> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, SceneReview> = {};
  for (const [sceneId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object') continue;
    const input = raw as Partial<SceneReview>;
    result[sceneId] = {
      sceneId,
      status: STATUSES.includes(input.status as SceneReviewStatus) ? input.status as SceneReviewStatus : 'pending',
      comments: Array.isArray(input.comments)
        ? input.comments.map(normalizeComment).filter((item): item is SceneReviewComment => Boolean(item))
        : [],
      updatedAt: String(input.updatedAt ?? ''),
    };
  }
  return result;
}

export function reviewFor(reviews: Record<string, SceneReview>, sceneId: string) {
  return reviews[sceneId] ?? emptySceneReview(sceneId);
}
