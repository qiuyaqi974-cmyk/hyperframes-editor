import { acceptedRoughCutCandidates } from '@/lib/roughCutPlan';
import { materializeExternalCandidates } from '@/lib/externalClipInbox';
import { analyzeOtio } from '@/lib/otioTimeline';
import { resolveSourceStoryAssembly, sourceRoughCutSignature } from '@/lib/sourceStoryAssembly';
import type { DirectorDecision, ExternalMediaSource, SourceStoryAssembly, SourceStoryAssemblyVersion } from '@/types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function versionLabel(index: number) {
  return index < 26 ? `方案 ${String.fromCharCode(65 + index)}` : `方案 ${index + 1}`;
}

export function sourceStoryVersionSignature(assembly: SourceStoryAssembly, segments: SourceStoryAssemblyVersion['segments']) {
  return JSON.stringify({
    items: assembly.items.map((item) => [item.sourceId, item.candidateId, item.narrativeRole ?? '']),
    segments: segments.map((segment) => [segment.sourceId, segment.candidateId, segment.start, segment.end]),
  });
}

export function sourceStoryAssemblyVersionSignature(assembly: SourceStoryAssembly, sources: ExternalMediaSource[]) {
  const resolved = resolveSourceStoryAssembly(assembly, sources);
  if (resolved.length !== assembly.items.length) return '';
  const segments = resolved.map((item) => ({
    sourceId: item.source.id, candidateId: item.candidate.id, sourceName: item.source.name, text: item.candidate.text,
    start: item.candidate.start, end: item.candidate.end, narrativeRole: item.narrativeRole,
  }));
  return sourceStoryVersionSignature(assembly, segments);
}

export function createSourceStoryVersion(
  assembly: SourceStoryAssembly,
  sources: ExternalMediaSource[],
  existing: SourceStoryAssemblyVersion[],
  note = '',
  now = new Date(),
): SourceStoryAssemblyVersion {
  const resolved = resolveSourceStoryAssembly(assembly, sources);
  if (!assembly.items.length || resolved.length !== assembly.items.length) throw new Error('当前全局结构含有失效片段，不能保存为方案。');
  const segments = resolved.map((item) => ({
    sourceId: item.source.id,
    candidateId: item.candidate.id,
    sourceName: item.source.name,
    text: item.candidate.text,
    start: item.candidate.start,
    end: item.candidate.end,
    narrativeRole: item.narrativeRole,
  }));
  const snapshot: SourceStoryAssembly = clone({ ...assembly, appliedAt: undefined, appliedBlockIds: undefined });
  const signature = sourceStoryVersionSignature(snapshot, segments);
  if (existing.some((version) => version.signature === signature)) throw new Error('这个剪法已经保存过，没有产生新的结构差异。');
  const createdAt = now.toISOString();
  return {
    id: `story-version-${now.getTime().toString(36)}-${existing.length + 1}`,
    label: versionLabel(existing.length),
    note: note.trim(),
    createdAt,
    signature,
    assembly: snapshot,
    segments: clone(segments),
  };
}

export interface SourceStoryVersionDiff {
  added: number;
  removed: number;
  moved: number;
  roleChanged: number;
  boundaryChanged: number;
  replacedPositions: number;
  leftDuration: number;
  rightDuration: number;
  durationDelta: number;
  leftSources: number;
  rightSources: number;
}

export function compareSourceStoryVersions(left: SourceStoryAssemblyVersion, right: SourceStoryAssemblyVersion): SourceStoryVersionDiff {
  const key = (segment: SourceStoryAssemblyVersion['segments'][number]) => `${segment.sourceId}:${segment.candidateId}`;
  const leftIndex = new Map(left.segments.map((segment, index) => [key(segment), index]));
  const rightIndex = new Map(right.segments.map((segment, index) => [key(segment), index]));
  const leftByKey = new Map(left.segments.map((segment) => [key(segment), segment]));
  const rightByKey = new Map(right.segments.map((segment) => [key(segment), segment]));
  const common = [...leftByKey.keys()].filter((item) => rightByKey.has(item));
  const leftDuration = left.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const rightDuration = right.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const positions = Math.max(left.segments.length, right.segments.length);
  const keyAt = (segments: SourceStoryAssemblyVersion['segments'], index: number) => segments[index] ? key(segments[index]) : '';
  return {
    added: right.segments.filter((segment) => !leftByKey.has(key(segment))).length,
    removed: left.segments.filter((segment) => !rightByKey.has(key(segment))).length,
    moved: common.filter((item) => leftIndex.get(item) !== rightIndex.get(item)).length,
    roleChanged: common.filter((item) => leftByKey.get(item)?.narrativeRole !== rightByKey.get(item)?.narrativeRole).length,
    boundaryChanged: common.filter((item) => {
      const before = leftByKey.get(item)!;
      const after = rightByKey.get(item)!;
      return Math.abs(before.start - after.start) > 0.001 || Math.abs(before.end - after.end) > 0.001;
    }).length,
    replacedPositions: Array.from({ length: positions }, (_, index) => keyAt(left.segments, index) !== keyAt(right.segments, index)).filter(Boolean).length,
    leftDuration,
    rightDuration,
    durationDelta: rightDuration - leftDuration,
    leftSources: new Set(left.segments.map((segment) => segment.sourceId)).size,
    rightSources: new Set(right.segments.map((segment) => segment.sourceId)).size,
  };
}

export function restoreSourceStoryVersion(version: SourceStoryAssemblyVersion, sources: ExternalMediaSource[], director: DirectorDecision, now = new Date()) {
  if (version.externalTimeline) {
    const reasons = analyzeOtio(version.externalTimeline.document).blockers;
    if (reasons.length) throw new Error(`OTIO 含${reasons.join('、')}，已完整保留，可重新导出；当前本机预演器不能还原这些效果，禁止扁平化恢复。请在外部工具处理后重新导回。`);
  }
  sources = materializeExternalCandidates(version, sources);
  const segmentByKey = new Map(version.segments.map((segment) => [`${segment.sourceId}:${segment.candidateId}`, segment]));
  const missing = version.segments.filter((segment) => {
    const source = sources.find((item) => item.id === segment.sourceId);
    const candidate = source?.roughCutPlan?.candidates.find((item) => item.id === segment.candidateId);
    return !source || !candidate || candidate.decision !== 'keep';
  });
  if (missing.length) throw new Error(`方案中有 ${missing.length} 个片段已不存在或不再保留，无法安全恢复。`);
  const nextSources = sources.map((source) => {
    if (!source.roughCutPlan) return source;
    const candidates = source.roughCutPlan.candidates.map((candidate) => {
      const saved = segmentByKey.get(`${source.id}:${candidate.id}`);
      if (!saved) return candidate;
      const sameBoundary = Math.abs(candidate.start - saved.start) <= 0.001 && Math.abs(candidate.end - saved.end) <= 0.001;
      return { ...candidate, start: saved.start, end: saved.end, visualReview: sameBoundary ? candidate.visualReview : undefined };
    });
    return { ...source, roughCutPlan: { ...source.roughCutPlan, candidates } };
  });
  const eligible = nextSources.filter((source) => source.roughCutPlan && acceptedRoughCutCandidates(source.roughCutPlan).length);
  const assembly: SourceStoryAssembly = {
    ...clone(version.assembly),
    generatedAt: now.toISOString(),
    directorUpdatedAt: director.updatedAt,
    sourceSignatures: Object.fromEntries(eligible.map((source) => [source.id, sourceRoughCutSignature(source)])),
    confirmedAt: undefined,
    preview: undefined,
    appliedAt: undefined,
    appliedBlockIds: undefined,
  };
  return { sources: nextSources, assembly };
}
