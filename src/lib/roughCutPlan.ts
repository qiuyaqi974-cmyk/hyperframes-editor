import type { DirectorDecision, NarrativeRole, SourceEventMarker, SourceRoughCutCandidate, SourceRoughCutPlan, SourceTranscriptSegment, SourceTranscriptWord } from '@/types';

export interface RoughCutPlanOptions {
  pauseThreshold?: number;
  paddingBefore?: number;
  paddingAfter?: number;
  now?: Date;
  markers?: SourceEventMarker[];
  markerSourceSignature?: string;
}

const paddingByPacing: Record<DirectorDecision['pacing'], { before: number; after: number }> = {
  calm: { before: 0.12, after: 0.16 },
  balanced: { before: 0.05, after: 0.08 },
  fast: { before: 0.03, after: 0.05 },
};

function cleanWords(segments: SourceTranscriptSegment[]) {
  return segments.flatMap((segment) => (segment.words ?? [])
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start && word.word.trim())
    .map((word) => ({ ...word, word: word.word }))
  ).sort((a, b) => a.start - b.start || a.end - b.end);
}

function candidateReason(boundary: SourceRoughCutCandidate['boundary'], pauseBefore: number | null, pauseAfter: number | null) {
  const gaps = [pauseBefore, pauseAfter].filter((gap): gap is number => gap !== null);
  const strongestGap = gaps.length ? Math.max(...gaps) : 0;
  const boundaryLabel = boundary === 'word' ? '逐词边界' : '字幕段边界';
  return `${boundaryLabel} · ${strongestGap >= 0.4 ? `邻近 ${strongestGap.toFixed(2)}s 停顿` : '短停顿，需重点试听'} · 画面需人工确认`;
}

function wordCandidates(words: SourceTranscriptWord[], duration: number, pauseThreshold: number, paddingBefore: number, paddingAfter: number) {
  const groups: SourceTranscriptWord[][] = [];
  let current: SourceTranscriptWord[] = [];
  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous && word.start - previous.end >= pauseThreshold) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length) groups.push(current);
  return groups.map((group, index): SourceRoughCutCandidate => {
    const first = group[0];
    const last = group[group.length - 1];
    const previousGroup = groups[index - 1];
    const previous = previousGroup?.[previousGroup.length - 1];
    const next = groups[index + 1]?.[0];
    const pauseBefore = previous ? Math.max(0, first.start - previous.end) : null;
    const pauseAfter = next ? Math.max(0, next.start - last.end) : null;
    return {
      id: `rough-word-${index + 1}-${first.start.toFixed(3)}`,
      start: Math.max(0, first.start - paddingBefore),
      end: Math.min(duration, last.end + paddingAfter),
      text: group.map((word) => word.word).join('').trim(),
      decision: 'review',
      boundary: 'word',
      pauseBefore,
      pauseAfter,
      reason: candidateReason('word', pauseBefore, pauseAfter),
      origin: 'speech',
    };
  }).filter((candidate) => candidate.end - candidate.start >= 0.1 && candidate.text);
}

function segmentCandidates(segments: SourceTranscriptSegment[], duration: number) {
  return segments
    .filter((segment) => segment.end > segment.start && segment.text.trim())
    .sort((a, b) => a.start - b.start)
    .map((segment, index, sorted): SourceRoughCutCandidate => {
      const pauseBefore = index ? Math.max(0, segment.start - sorted[index - 1].end) : null;
      const pauseAfter = index < sorted.length - 1 ? Math.max(0, sorted[index + 1].start - segment.end) : null;
      return {
        id: `rough-segment-${index + 1}-${segment.start.toFixed(3)}`,
        start: Math.max(0, segment.start - 0.2),
        end: Math.min(duration, segment.end + 0.2),
        text: segment.text.trim(),
        decision: 'review',
        boundary: 'segment',
        pauseBefore,
        pauseAfter,
        reason: candidateReason('segment', pauseBefore, pauseAfter),
        origin: 'speech',
      };
    });
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.01;
}

const exclusionTerms = ['废片', '失误', '遮挡', '模糊', '穿帮', '空镜过长', '无效', '重复'];
const turnTerms = ['但是', '不过', '结果', '突然', '意外', '问题', '失败', '转折'];
const proofTerms = ['完成', '成品', '效果', '对比', '结果', '展示', '证明', '细节'];
const ctaTerms = ['关注', '点赞', '评论', '收藏', '下期', '试试看', '一起做'];

function semanticsText(marker: SourceEventMarker) {
  const semantics = marker.semantics;
  return semantics ? [semantics.subject, semantics.action, semantics.object, semantics.result, ...semantics.tags].join(' ') : '';
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function suggestedRole(candidate: SourceRoughCutCandidate, markers: SourceEventMarker[], duration: number): NarrativeRole {
  const evidence = `${candidate.text} ${markers.map(semanticsText).join(' ')}`;
  if (hasAny(evidence, ctaTerms)) return 'cta';
  if (hasAny(evidence, turnTerms)) return 'turn';
  if (hasAny(evidence, proofTerms) || markers.some((marker) => Boolean(marker.semantics?.result.trim()))) return 'proof';
  const position = duration > 0 ? candidate.start / duration : 0;
  if (position <= 0.15) return 'hook';
  if (position <= 0.35) return 'context';
  return 'argument';
}

function addMultimodalSuggestions(candidates: SourceRoughCutCandidate[], markers: SourceEventMarker[], duration: number) {
  const confirmedSemantics = markers.filter((marker) => marker.semantics?.method === 'human-observed');
  return candidates.map((candidate) => {
    const visualMarkers = confirmedSemantics.filter((marker) => overlaps(candidate, marker));
    if (!visualMarkers.length) return candidate;
    // 每条人工视觉语义都有对应 event 候选；只在该候选上给联合建议，避免同时建议保留重叠的语音候选。
    if (candidate.origin === 'speech') return candidate;
    const confirmedVisualText = visualMarkers.map(semanticsText).join(' ');
    const decision = hasAny(confirmedVisualText, exclusionTerms) ? 'drop' as const : 'keep' as const;
    const transcriptEvidence = candidates.some((other) => other.origin === 'speech' && overlaps(candidate, other));
    const visualSummary = visualMarkers.map((marker) => marker.label).join('、');
    const reason = decision === 'drop'
      ? `已确认视觉语义包含排除信号（${visualSummary}），建议人工核对后排除`
      : `${transcriptEvidence ? '口播区间与' : ''}已确认视觉动作“${visualSummary}”重叠，建议人工核对后保留`;
    return {
      ...candidate,
      suggestion: {
        decision,
        narrativeRole: decision === 'keep' ? suggestedRole(candidate, visualMarkers, duration) : undefined,
        reason,
        transcriptEvidence,
        confirmedVisualMarkerIds: visualMarkers.map((marker) => marker.id),
      },
    };
  });
}

function manualCandidates(markers: SourceEventMarker[], words: SourceTranscriptWord[], duration: number, paddingBefore: number, paddingAfter: number) {
  return markers.map((marker): SourceRoughCutCandidate => {
    let start = Math.max(0, marker.start);
    let end = Math.min(duration, marker.end);
    const startWord = words.find((word) => word.start < start && word.end > start);
    const endWord = words.find((word) => word.start < end && word.end > end);
    if (startWord) start = Math.max(0, startWord.start - paddingBefore);
    if (endWord) end = Math.min(duration, endWord.end + paddingAfter);
    const snapped = Math.abs(start - marker.start) > 0.001 || Math.abs(end - marker.end) > 0.001;
    return {
      id: `rough-event-${marker.id}`,
      markerId: marker.id,
      origin: 'event',
      start,
      end,
      text: marker.label,
      decision: marker.kind === 'highlight' ? 'keep' : marker.kind === 'exclude' ? 'drop' : 'review',
      boundary: 'manual',
      pauseBefore: null,
      pauseAfter: null,
      reason: `人工${marker.kind === 'highlight' ? '重点' : marker.kind === 'exclude' ? '排除' : '动作'}标记${snapped ? ' · 已向外吸附完整词边界' : ''}`,
      visualReview: marker.kind === 'exclude' || marker.semantics ? undefined : {
        status: 'approved',
        checkedAt: marker.createdAt,
        windowStart: start,
        windowEnd: end,
      },
    };
  });
}

export function createSourceRoughCutPlan(
  sourceId: string,
  duration: number,
  segments: SourceTranscriptSegment[],
  director: DirectorDecision,
  options: RoughCutPlanOptions = {},
): SourceRoughCutPlan {
  const defaults = paddingByPacing[director.pacing];
  const pauseThreshold = options.pauseThreshold ?? 0.45;
  const paddingBefore = options.paddingBefore ?? defaults.before;
  const paddingAfter = options.paddingAfter ?? defaults.after;
  const words = cleanWords(segments);
  const markers = (options.markers ?? []).filter((marker) => !marker.semantics || (
    marker.semantics.sourceSignature === options.markerSourceSignature
    && marker.semantics.start === marker.start && marker.semantics.end === marker.end
    && Number.isFinite(marker.start) && Number.isFinite(marker.end)
    && marker.start >= 0 && marker.end <= duration && marker.end - marker.start >= 0.1
  ));
  const excludedMarkers = markers.filter((marker) => marker.kind === 'exclude');
  const speechCandidates = (words.length
    ? wordCandidates(words, duration, pauseThreshold, paddingBefore, paddingAfter)
    : segmentCandidates(segments, duration))
    .map((candidate) => excludedMarkers.some((marker) => overlaps(candidate, marker)) ? {
      ...candidate,
      decision: 'drop' as const,
      reason: `${candidate.reason} · 与人工排除区间重叠`,
    } : candidate);
  const candidates = addMultimodalSuggestions(
    [...speechCandidates, ...manualCandidates(markers, words, duration, paddingBefore, paddingAfter)]
      .sort((a, b) => a.start - b.start || a.end - b.end),
    markers,
    duration,
  );
  return {
    version: 1,
    sourceId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    strategy: {
      pauseThreshold,
      paddingBefore,
      paddingAfter,
      pacing: director.pacing,
      objective: director.objective,
      thesis: director.thesis,
      directorUpdatedAt: director.updatedAt,
    },
    candidates,
    assembly: { order: candidates.filter((candidate) => candidate.decision === 'keep').map((candidate) => candidate.id) },
  };
}

function syncedOrder(plan: SourceRoughCutPlan, candidates = plan.candidates) {
  const keptIds = new Set(candidates.filter((candidate) => candidate.decision === 'keep').map((candidate) => candidate.id));
  const existing = (plan.assembly?.order ?? []).filter((id) => keptIds.delete(id));
  const newlyKept = candidates.filter((candidate) => keptIds.has(candidate.id)).map((candidate) => candidate.id);
  return [...existing, ...newlyKept];
}

function withUnconfirmedAssembly(plan: SourceRoughCutPlan, candidates = plan.candidates): SourceRoughCutPlan {
  return { ...plan, candidates, assembly: { order: syncedOrder(plan, candidates) } };
}

export function updateRoughCutDecision(plan: SourceRoughCutPlan, candidateId: string, decision: SourceRoughCutCandidate['decision']): SourceRoughCutPlan {
  const candidates = plan.candidates.map((candidate) => candidate.id === candidateId ? { ...candidate, decision } : candidate);
  return withUnconfirmedAssembly(plan, candidates);
}

export function applyRoughCutSuggestion(plan: SourceRoughCutPlan, candidateId: string): SourceRoughCutPlan {
  const candidates = plan.candidates.map((candidate) => {
    if (candidate.id !== candidateId || !candidate.suggestion) return candidate;
    return {
      ...candidate,
      decision: candidate.suggestion.decision,
      narrativeRole: candidate.suggestion.decision === 'keep' ? candidate.suggestion.narrativeRole : candidate.narrativeRole,
    };
  });
  return withUnconfirmedAssembly(plan, candidates);
}

export function acceptedRoughCutCandidates(plan: SourceRoughCutPlan) {
  const kept = plan.candidates.filter((candidate) => candidate.decision === 'keep');
  const byId = new Map(kept.map((candidate) => [candidate.id, candidate]));
  const ordered = (plan.assembly?.order ?? []).map((id) => byId.get(id)).filter((candidate): candidate is SourceRoughCutCandidate => Boolean(candidate));
  const used = new Set(ordered.map((candidate) => candidate.id));
  return [...ordered, ...kept.filter((candidate) => !used.has(candidate.id)).sort((a, b) => a.start - b.start)];
}

export function assignRoughCutRole(plan: SourceRoughCutPlan, candidateId: string, narrativeRole: NarrativeRole): SourceRoughCutPlan {
  return withUnconfirmedAssembly(plan, plan.candidates.map((candidate) => candidate.id === candidateId ? { ...candidate, narrativeRole } : candidate));
}

export function moveRoughCutCandidate(plan: SourceRoughCutPlan, candidateId: string, direction: -1 | 1): SourceRoughCutPlan {
  const order = syncedOrder(plan);
  const index = order.indexOf(candidateId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return plan;
  [order[index], order[target]] = [order[target], order[index]];
  return { ...plan, assembly: { order } };
}

const roleTemplates: Record<DirectorDecision['contentType'], NarrativeRole[]> = {
  tutorial: ['hook', 'context', 'argument', 'proof', 'cta'],
  knowledge: ['hook', 'context', 'argument', 'proof', 'cta'],
  product: ['hook', 'context', 'proof', 'argument', 'cta'],
  story: ['hook', 'context', 'argument', 'turn', 'proof', 'cta'],
  other: ['hook', 'context', 'argument', 'proof', 'cta'],
};

function roleForPosition(index: number, total: number, template: NarrativeRole[]) {
  if (total <= 1) return template[0];
  const templateIndex = Math.round(index * (template.length - 1) / (total - 1));
  return template[templateIndex];
}

export function applyRoughCutRoleTemplate(plan: SourceRoughCutPlan, contentType: DirectorDecision['contentType']): SourceRoughCutPlan {
  const order = syncedOrder(plan);
  const positions = new Map(order.map((id, index) => [id, index]));
  const candidates = plan.candidates.map((candidate) => {
    const index = positions.get(candidate.id);
    return index === undefined ? candidate : { ...candidate, narrativeRole: roleForPosition(index, order.length, roleTemplates[contentType]) };
  });
  return { ...plan, candidates, assembly: { order } };
}

export function syncRoughCutDirectorContext(plan: SourceRoughCutPlan, director: DirectorDecision): SourceRoughCutPlan {
  return {
    ...plan,
    strategy: { ...plan.strategy, pacing: director.pacing, objective: director.objective, thesis: director.thesis, directorUpdatedAt: director.updatedAt },
    assembly: { order: syncedOrder(plan) },
  };
}

export function confirmRoughCutStructure(plan: SourceRoughCutPlan, now = new Date()): SourceRoughCutPlan {
  const readiness = roughCutPlanReadiness(plan, plan.strategy.directorUpdatedAt);
  if (!readiness.structureComplete) throw new Error('请先为所有保留片段指定叙事职责，并确保编排顺序完整。');
  return { ...plan, assembly: { order: syncedOrder(plan), confirmedAt: now.toISOString() } };
}

export function roughCutPlanReadiness(plan: SourceRoughCutPlan, currentDirectorUpdatedAt = plan.strategy.directorUpdatedAt ?? '') {
  const kept = acceptedRoughCutCandidates(plan);
  const unchecked = kept.filter((candidate) => candidate.visualReview?.status !== 'approved');
  const missingRoles = kept.filter((candidate) => !candidate.narrativeRole);
  const order = plan.assembly?.order ?? [];
  const keptIds = new Set(kept.map((candidate) => candidate.id));
  const structureComplete = kept.length > 0 && missingRoles.length === 0 && order.length === kept.length
    && new Set(order).size === order.length && order.every((id) => keptIds.has(id));
  const structureConfirmed = structureComplete && Boolean(plan.assembly?.confirmedAt);
  const directorStale = Boolean(currentDirectorUpdatedAt) && plan.strategy.directorUpdatedAt !== currentDirectorUpdatedAt;
  const overlapPairs: Array<[string, string]> = [];
  for (let left = 0; left < kept.length; left += 1) {
    for (let right = left + 1; right < kept.length; right += 1) {
      if (overlaps(kept[left], kept[right])) overlapPairs.push([kept[left].id, kept[right].id]);
    }
  }
  return {
    kept,
    unchecked,
    missingRoles,
    overlapPairs,
    structureComplete,
    structureConfirmed,
    directorStale,
    duration: kept.reduce((sum, candidate) => sum + candidate.end - candidate.start, 0),
    ready: kept.length > 0 && unchecked.length === 0 && overlapPairs.length === 0 && structureConfirmed && !directorStale && !plan.appliedBlockIds?.length,
  };
}

export function adjustRoughCutPadding(
  plan: SourceRoughCutPlan,
  candidateId: string,
  edge: 'start' | 'end',
  delta: number,
  segments: SourceTranscriptSegment[],
  duration: number,
) {
  const words = cleanWords(segments);
  if (!words.length) return plan;
  return {
    ...plan,
    candidates: plan.candidates.map((candidate) => {
      if (candidate.id !== candidateId || candidate.boundary !== 'word') return candidate;
      const inside = words.filter((word) => word.end >= candidate.start && word.start <= candidate.end);
      if (!inside.length) return candidate;
      const first = inside[0];
      const last = inside[inside.length - 1];
      if (edge === 'start') {
        const current = Math.max(0.03, first.start - candidate.start);
        const padding = Math.max(0.03, Math.min(0.2, current + delta));
        return { ...candidate, start: Math.max(0, first.start - padding), visualReview: undefined };
      }
      const current = Math.max(0.03, candidate.end - last.end);
      const padding = Math.max(0.03, Math.min(0.2, current + delta));
      return { ...candidate, end: Math.min(duration, last.end + padding), visualReview: undefined };
    }),
  };
}
