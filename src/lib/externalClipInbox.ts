import { importRefinedStoryEdl, parseEdl } from './sourceStoryRoundtrip';
import { compareSourceStoryVersions } from './sourceStoryVersions';
import { analyzeOtio, applyOtioReview, otioToEdl } from './otioTimeline';
import type { ExternalClipInbox, ExternalMediaSource, SourceStoryAssemblyVersion, SourceRoughCutCandidate } from '@/types';

const pathKey = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

export function inspectExternalClips(input: unknown, base: SourceStoryAssemblyVersion, sources: ExternalMediaSource[], fileName: string, now = new Date()): ExternalClipInbox {
  const otio = input && typeof input === 'object' && 'OTIO_SCHEMA' in input ? otioToEdl(input, base, sources) : undefined;
  const edl = parseEdl(otio?.edl ?? input);
  if (edl.metadata?.originVersionId && edl.metadata.originVersionId !== base.id) throw new Error('这份 EDL 不是从当前胜出方案导出的。');
  const inbox: ExternalClipInbox = { id: `external-${crypto.randomUUID()}`, fileName, importedAt: now.toISOString(), parentVersionId: base.id, input: edl, clips: [] };
  if (otio) inbox.externalTimeline = { format: 'otio', document: otio.analysis.document };
  const seen = new Set<string>();
  edl.ranges.forEach((range, index) => {
    const source = range.sourceId ? sources.find((s) => s.id === range.sourceId) : sources.find((s) => pathKey(s.path) === pathKey(edl.sources[range.source]));
    if (!source) throw new Error(`第 ${index + 1} 段引用工程外素材或未知原片 ID。`);
    if (pathKey(source.path) !== pathKey(edl.sources[range.source])) throw new Error(`第 ${index + 1} 段素材路径错版。`);
    if (range.end > source.duration) throw new Error(`第 ${index + 1} 段超出原片时长。`);
    const words = (source.transcript ?? []).flatMap((s) => s.words ?? []);
    if (words.some((w) => [range.start, range.end].some((t) => t > w.start + 0.005 && t < w.end - 0.005))) throw new Error(`第 ${index + 1} 段切点落在词语内部。`);
    const original = range.candidateId && base.segments.find((s) => s.candidateId === range.candidateId && s.sourceId === source.id);
    const key = original ? `${source.id}:${original.candidateId}` : `${source.id}:${range.start}:${range.end}`;
    if (seen.has(key)) throw new Error('EDL 重复引用片段。');
    seen.add(key);
    if (original) {
      if (!source.roughCutPlan?.candidates.some((c) => c.id === original.candidateId && c.decision === 'keep')) throw new Error('原候选已失效或不再保留。');
      return;
    }
    inbox.clips.push({ id: `${inbox.id}-${index}`, rangeIndex: index, sourceId: source.id, sourcePath: source.path, start: range.start, end: range.end, label: range.label ?? '', text: range.quote ?? '', narrativeRole: range.beat, mappingStatus: 'pending', boundaryStatus: words.length ? 'word' : 'manual', boundaryConfirmed: false, visualStatus: 'pending', decision: 'pending', reason: '' });
  });
  return inbox;
}

export function finalizeExternalClips(inbox: ExternalClipInbox, base: SourceStoryAssemblyVersion, sources: ExternalMediaSource[], versions: SourceStoryAssemblyVersion[]) {
  if (inbox.savedVersionId) throw new Error('此收件箱已经保存。');
  if (base.id !== inbox.parentVersionId) throw new Error('父胜出方案不匹配。');
  const checked = inspectExternalClips(inbox.externalTimeline?.document ?? inbox.input, base, sources, inbox.fileName);
  if (inbox.externalTimeline && JSON.stringify(checked.input) !== JSON.stringify(inbox.input)) throw new Error('OTIO 审核映射已变化，请重新导入。');
  if (checked.clips.length !== inbox.clips.length) throw new Error('素材映射已变化，请重新导入。');
  for (const expected of checked.clips) {
    const clip = inbox.clips.find((c) => c.rangeIndex === expected.rangeIndex);
    if (!clip || clip.sourceId !== expected.sourceId || clip.sourcePath !== expected.sourcePath || clip.start !== expected.start || clip.end !== expected.end || clip.boundaryStatus !== expected.boundaryStatus) throw new Error('素材或边界已变化，请重新审核。');
    if (clip.decision === 'pending') throw new Error('所有新增片段必须完成最终决定。');
    if (clip.decision === 'reject' && !clip.reason.trim()) throw new Error('请填写拒绝理由。');
    if (clip.decision === 'approve' && (clip.mappingStatus !== 'confirmed' || !clip.boundaryConfirmed || clip.visualStatus !== 'approved' || !clip.narrativeRole)) throw new Error('允许纳入前必须完成来源、边界、视觉检查和叙事职责。');
  }
  const edl = parseEdl(inbox.input);
  const additions: NonNullable<SourceStoryAssemblyVersion['externalCandidates']> = [];
  edl.ranges = edl.ranges.flatMap((range, index) => {
    const clip = inbox.clips.find((c) => c.rangeIndex === index);
    if (!clip) return [range];
    if (clip.decision === 'reject') return [];
    const candidate: SourceRoughCutCandidate = { id: clip.id, start: clip.start, end: clip.end, text: clip.text, decision: 'keep', boundary: clip.boundaryStatus, pauseBefore: null, pauseAfter: null, reason: `外部 EDL ${inbox.fileName} · ${inbox.id} · 父方案 ${base.id}`, narrativeRole: clip.narrativeRole };
    additions.push({ sourceId: clip.sourceId, sourcePath: clip.sourcePath, candidate });
    return [{ ...range, candidateId: candidate.id, sourceId: clip.sourceId, beat: clip.narrativeRole }];
  });
  const augmentedSources = materializeExternalCandidates({ ...base, externalCandidates: additions }, sources);
  const augmentedBase = { ...base, segments: [...base.segments, ...additions.map(({ sourceId, candidate }) => ({ sourceId, candidateId: candidate.id, sourceName: sources.find((s) => s.id === sourceId)!.name, text: candidate.text, start: candidate.start, end: candidate.end, narrativeRole: candidate.narrativeRole }))] };
  const result = importRefinedStoryEdl(edl, augmentedBase, augmentedSources, versions, inbox.fileName, new Date(), inbox.clips.length > 0 || Boolean(inbox.externalTimeline));
  result.version.externalCandidates = [...(base.externalCandidates ?? []).filter((item) => result.version.segments.some((s) => s.sourceId === item.sourceId && s.candidateId === item.candidate.id)), ...additions];
  result.diff = compareSourceStoryVersions(base, result.version);
  if (/\.fcpxml$|\.xml$/i.test(inbox.fileName)) {
    result.version.provenance!.kind = 'external-fcpxml';
    result.version.note = `FCPXML 外部时间线 · 基于 ${base.label}`;
  }
  if (inbox.externalTimeline) {
    const decisions = new Map(inbox.clips.map((clip) => [clip.rangeIndex, { reject: clip.decision === 'reject', candidateId: clip.id, role: clip.narrativeRole, reason: clip.reason }]));
    const document = applyOtioReview(inbox.externalTimeline.document, base, sources, decisions);
    analyzeOtio(document);
    if (versions.some((version) => version.externalTimeline && JSON.stringify(version.externalTimeline.document) === JSON.stringify(document))) throw new Error('这份 OTIO 时间线已经保存为方案。');
    result.version.externalTimeline = { format: 'otio', document };
    result.version.provenance!.kind = 'external-otio';
    result.version.note = `OTIO 外部时间线 · 基于 ${base.label}`;
  }
  return result;
}

/** Candidates remain in the immutable version until the user explicitly restores it. */
export function materializeExternalCandidates(version: SourceStoryAssemblyVersion, sources: ExternalMediaSource[]): ExternalMediaSource[] {
  for (const entry of version.externalCandidates ?? []) {
    const source = sources.find((s) => s.id === entry.sourceId);
    if (!source || pathKey(source.path) !== pathKey(entry.sourcePath)) throw new Error('外部候选原片缺失或路径错版。');
    const { start, end } = entry.candidate;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > source.duration) throw new Error('外部候选切点越界。');
    if ((source.transcript ?? []).flatMap((segment) => segment.words ?? []).some((word) => [start, end].some((cut) => cut > word.start + 0.005 && cut < word.end - 0.005))) throw new Error('外部候选切点落在词语内部。');
  }
  return sources.map((source) => {
    const additions = (version.externalCandidates ?? []).filter((item) => item.sourceId === source.id && !source.roughCutPlan?.candidates.some((c) => c.id === item.candidate.id)).map((item) => ({ ...item.candidate, visualReview: undefined }));
    if (!additions.length) return source;
    const plan = source.roughCutPlan ?? { version: 1 as const, sourceId: source.id, generatedAt: version.createdAt, strategy: { pauseThreshold: 0.45, paddingBefore: 0.05, paddingAfter: 0.08, pacing: 'balanced' as const, objective: '', thesis: '' }, candidates: [] };
    return { ...source, roughCutPlan: { ...plan, candidates: [...plan.candidates, ...additions] } };
  });
}
