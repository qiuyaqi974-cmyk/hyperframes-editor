import { compareSourceStoryVersions, sourceStoryVersionSignature } from '@/lib/sourceStoryVersions';
import { sourceRoughCutSignature } from '@/lib/sourceStoryAssembly';
import type { ExternalMediaSource, NarrativeRole, SourceStoryAssembly, SourceStoryAssemblyVersion } from '@/types';

const narrativeRoles = new Set<NarrativeRole>(['hook', 'context', 'argument', 'proof', 'turn', 'cta', 'custom']);

interface ImportedRange {
  source: string;
  sourceId?: string;
  candidateId?: string;
  start: number;
  end: number;
  beat?: NarrativeRole;
  quote?: string;
  label?: string;
}

export interface ImportedEdl {
  version: number;
  kind?: string;
  metadata?: { originVersionId?: string };
  sources: Record<string, string>;
  ranges: ImportedRange[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

export function parseEdl(input: unknown): ImportedEdl {
  if (!input || typeof input !== 'object') throw new Error('精剪 EDL 必须是 JSON 对象。');
  const data = input as Record<string, unknown>;
  if (!data.sources || typeof data.sources !== 'object' || Array.isArray(data.sources)) throw new Error('精剪 EDL 缺少 sources 路径表。');
  if (!Array.isArray(data.ranges) || !data.ranges.length) throw new Error('精剪 EDL 没有任何片段。');
  const sources = Object.fromEntries(Object.entries(data.sources).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1])));
  const ranges = data.ranges.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`精剪 EDL 第 ${index + 1} 段无效。`);
    const item = raw as Record<string, unknown>;
    const source = String(item.source ?? '');
    const start = Number(item.start);
    const end = Number(item.end);
    if (!sources[source]) throw new Error(`精剪 EDL 第 ${index + 1} 段引用未知素材别名 ${source}。`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(`精剪 EDL 第 ${index + 1} 段时间无效。`);
    const beat = typeof item.beat === 'string' && narrativeRoles.has(item.beat as NarrativeRole) ? item.beat as NarrativeRole : undefined;
    return { source, start, end, ...(typeof item.sourceId === 'string' ? { sourceId: item.sourceId } : {}), ...(typeof item.candidateId === 'string' ? { candidateId: item.candidateId } : {}), ...(beat ? { beat } : {}), ...(typeof item.quote === 'string' ? { quote: item.quote } : {}), ...(typeof item.label === 'string' ? { label: item.label } : {}) };
  });
  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata as { originVersionId?: string } : undefined;
  return { version: Number(data.version) || 1, ...(typeof data.kind === 'string' ? { kind: data.kind } : {}), ...(metadata ? { metadata } : {}), sources, ranges };
}

function candidateForRange(range: ImportedRange, index: number, edl: ImportedEdl, base: SourceStoryAssemblyVersion, sources: ExternalMediaSource[]) {
  const sourcePath = edl.sources[range.source];
  const source = sources.find((item) => item.id === range.sourceId) ?? sources.find((item) => normalizePath(item.path) === normalizePath(sourcePath));
  if (!source) throw new Error(`第 ${index + 1} 段引用了工程外素材；请先把素材纳入 HyperFrames 再重新粗剪。`);
  if (normalizePath(source.path) !== normalizePath(sourcePath)) throw new Error(`第 ${index + 1} 段的素材路径与工程记录不一致。`);
  if (range.end > source.duration + 0.05) throw new Error(`第 ${index + 1} 段出点超出原片时长。`);
  let original = range.candidateId ? base.segments.find((segment) => segment.sourceId === source.id && segment.candidateId === range.candidateId) : undefined;
  if (!original && !range.candidateId) {
    const ordinal = /^(\d+)/.exec(range.label ?? '')?.[1];
    if (ordinal) original = base.segments[Number(ordinal) - 1];
  }
  if (!original || original.sourceId !== source.id) throw new Error(`第 ${index + 1} 段不是从原胜出方案导出的可追溯片段；外部新增片段不会被静默写回。`);
  const candidate = source.roughCutPlan?.candidates.find((item) => item.id === original!.candidateId);
  if (!candidate || candidate.decision !== 'keep') throw new Error(`第 ${index + 1} 段对应的源候选已失效或不再保留。`);
  const words = (source.transcript ?? []).flatMap((segment) => segment.words ?? []);
  const cutsInsideWord = words.some((word) =>
    (range.start > word.start + 0.005 && range.start < word.end - 0.005)
    || (range.end > word.start + 0.005 && range.end < word.end - 0.005));
  if (cutsInsideWord) throw new Error(`第 ${index + 1} 段的精剪切点落在词语内部；请在外部工具中移到完整词边界后再导回。`);
  const duplicateKey = `${source.id}:${candidate.id}`;
  return { source, candidate, original, duplicateKey };
}

export function importRefinedStoryEdl(
  input: unknown,
  base: SourceStoryAssemblyVersion,
  sources: ExternalMediaSource[],
  existing: SourceStoryAssemblyVersion[],
  fileName: string,
  now = new Date(),
  allowUnchanged = false,
) {
  const edl = parseEdl(input);
  if (edl.metadata?.originVersionId && edl.metadata.originVersionId !== base.id) throw new Error('这份 EDL 不是从当前胜出方案导出的。');
  const seen = new Set<string>();
  const resolved = edl.ranges.map((range, index) => {
    const match = candidateForRange(range, index, edl, base, sources);
    if (seen.has(match.duplicateKey)) throw new Error(`第 ${index + 1} 段重复引用同一个原始片段，无法安全回写。`);
    seen.add(match.duplicateKey);
    return { range, ...match };
  });
  const assembly: SourceStoryAssembly = {
    ...clone(base.assembly), generatedAt: now.toISOString(),
    sourceSignatures: Object.fromEntries(sources.filter((source) => source.roughCutPlan).map((source) => [source.id, sourceRoughCutSignature(source)])),
    items: resolved.map(({ source, candidate, range, original }) => ({ sourceId: source.id, candidateId: candidate.id, narrativeRole: range.beat ?? original.narrativeRole })),
    confirmedAt: undefined, preview: undefined, appliedAt: undefined, appliedBlockIds: undefined,
  };
  const segments = resolved.map(({ source, candidate, range, original }) => ({
    sourceId: source.id, candidateId: candidate.id, sourceName: source.name, text: range.quote?.trim() || original.text,
    start: range.start, end: range.end, narrativeRole: range.beat ?? original.narrativeRole,
  }));
  const signature = sourceStoryVersionSignature(assembly, segments);
  if (!allowUnchanged && signature === base.signature) throw new Error('导回的 EDL 与原胜出方案完全相同，没有可保存的精剪变化。');
  if (!allowUnchanged && existing.some((version) => version.signature === signature)) throw new Error('这份精剪结果已经保存为方案。');
  const version: SourceStoryAssemblyVersion = {
    externalCandidates: base.externalCandidates?.filter((entry) => segments.some((segment) => segment.sourceId === entry.sourceId && segment.candidateId === entry.candidate.id)),
    id: `story-version-${now.getTime().toString(36)}-${existing.length + 1}`,
    label: existing.length < 26 ? `方案 ${String.fromCharCode(65 + existing.length)}` : `方案 ${existing.length + 1}`,
    note: `外部精剪回写 · 基于 ${base.label}`,
    createdAt: now.toISOString(), signature, assembly, segments,
    provenance: { kind: 'external-edl', parentVersionId: base.id, importedAt: now.toISOString(), fileName },
  };
  return { edl, version, diff: compareSourceStoryVersions(base, version) };
}
