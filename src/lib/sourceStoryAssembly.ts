import { acceptedRoughCutCandidates, adjustRoughCutPadding } from '@/lib/roughCutPlan';
import type { DirectorDecision, ExternalMediaSource, NarrativeRole, SourceStoryAssembly } from '@/types';

export interface ResolvedStoryItem {
  source: ExternalMediaSource;
  candidate: NonNullable<ExternalMediaSource['roughCutPlan']>['candidates'][number];
  narrativeRole: NarrativeRole | undefined;
}

export interface StoryDuplicateWarning {
  left: ResolvedStoryItem;
  right: ResolvedStoryItem;
  similarity: number;
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(value: string) {
  const normalized = normalizedText(value);
  if (normalized.length < 2) return new Set(normalized ? [normalized] : []);
  return new Set(Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2)));
}

function textSimilarity(left: string, right: string) {
  const aText = normalizedText(left);
  const bText = normalizedText(right);
  if (!aText || !bText) return 0;
  if (aText === bText) return 1;
  if (Math.min(aText.length, bText.length) >= 6 && (aText.includes(bText) || bText.includes(aText))) return 0.92;
  const a = bigrams(left);
  const b = bigrams(right);
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function sourceRoughCutSignature(source: ExternalMediaSource) {
  const plan = source.roughCutPlan;
  if (!plan) return '';
  return JSON.stringify({
    generatedAt: plan.generatedAt,
    order: plan.assembly?.order ?? [],
    candidates: plan.candidates.map(({ id, start, end, decision, narrativeRole, visualReview }) => [id, start, end, decision, narrativeRole ?? '', visualReview?.status ?? '']),
  });
}

export function createSourceStoryAssembly(sources: ExternalMediaSource[], director: DirectorDecision, now = new Date()): SourceStoryAssembly {
  const eligible = sources.filter((source) => source.roughCutPlan && acceptedRoughCutCandidates(source.roughCutPlan).length);
  return {
    version: 1,
    generatedAt: now.toISOString(),
    directorUpdatedAt: director.updatedAt,
    sourceSignatures: Object.fromEntries(eligible.map((source) => [source.id, sourceRoughCutSignature(source)])),
    items: eligible.flatMap((source) => acceptedRoughCutCandidates(source.roughCutPlan!).map((candidate) => ({
      sourceId: source.id,
      candidateId: candidate.id,
      narrativeRole: candidate.narrativeRole,
    }))),
  };
}

export function resolveSourceStoryAssembly(assembly: SourceStoryAssembly, sources: ExternalMediaSource[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return assembly.items.map((item) => {
    const source = sourceById.get(item.sourceId);
    const candidate = source?.roughCutPlan?.candidates.find((entry) => entry.id === item.candidateId && entry.decision === 'keep');
    return source && candidate ? { source, candidate, narrativeRole: item.narrativeRole } : null;
  }).filter((item): item is ResolvedStoryItem => Boolean(item));
}

export function moveSourceStoryItem(assembly: SourceStoryAssembly, index: number, direction: -1 | 1): SourceStoryAssembly {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= assembly.items.length) return assembly;
  const items = [...assembly.items];
  [items[index], items[target]] = [items[target], items[index]];
  return { ...assembly, items, confirmedAt: undefined, preview: undefined };
}

export function assignSourceStoryRole(assembly: SourceStoryAssembly, index: number, narrativeRole: NarrativeRole): SourceStoryAssembly {
  return { ...assembly, items: assembly.items.map((item, itemIndex) => itemIndex === index ? { ...item, narrativeRole } : item), confirmedAt: undefined, preview: undefined };
}

export function removeSourceStoryItem(assembly: SourceStoryAssembly, index: number): SourceStoryAssembly {
  return { ...assembly, items: assembly.items.filter((_, itemIndex) => itemIndex !== index), confirmedAt: undefined, preview: undefined };
}

export function replaceSourceStoryItem(assembly: SourceStoryAssembly, index: number, sourceId: string, candidateId: string): SourceStoryAssembly {
  if (assembly.items.some((item, itemIndex) => itemIndex !== index && item.sourceId === sourceId && item.candidateId === candidateId)) {
    throw new Error('这个候选已经在全局故事里。');
  }
  return {
    ...assembly,
    items: assembly.items.map((item, itemIndex) => itemIndex === index ? { sourceId, candidateId, narrativeRole: item.narrativeRole } : item),
    confirmedAt: undefined,
    preview: undefined,
  };
}

function currentSourceSignatures(sources: ExternalMediaSource[]) {
  const eligible = sources.filter((source) => source.roughCutPlan && acceptedRoughCutCandidates(source.roughCutPlan).length);
  return Object.fromEntries(eligible.map((source) => [source.id, sourceRoughCutSignature(source)]));
}

export function reviseSourceStoryBoundary(
  assembly: SourceStoryAssembly,
  sources: ExternalMediaSource[],
  director: DirectorDecision,
  itemIndex: number,
  edge: 'start' | 'end',
  delta: number,
) {
  const item = assembly.items[itemIndex];
  const source = item && sources.find((entry) => entry.id === item.sourceId);
  const plan = source?.roughCutPlan;
  const candidate = plan?.candidates.find((entry) => entry.id === item?.candidateId);
  if (!source || !plan || !candidate) throw new Error('这个切点对应的源片段已经失效。');
  if (candidate.boundary !== 'word' || !source.transcript?.some((segment) => segment.words?.length)) {
    throw new Error('这个片段没有逐词边界，不能安全自动微调。');
  }
  const adjusted = adjustRoughCutPadding(plan, candidate.id, edge, delta, source.transcript, source.duration);
  const nextCandidate = adjusted.candidates.find((entry) => entry.id === candidate.id)!;
  if (nextCandidate.start === candidate.start && nextCandidate.end === candidate.end) throw new Error('已经达到 30–200ms 的安全余量边界。');
  const nextSources = sources.map((entry) => entry.id === source.id ? { ...entry, roughCutPlan: adjusted } : entry);
  const nextAssembly: SourceStoryAssembly = {
    ...assembly,
    directorUpdatedAt: director.updatedAt,
    sourceSignatures: currentSourceSignatures(nextSources),
    confirmedAt: undefined,
    preview: undefined,
  };
  return { sources: nextSources, assembly: nextAssembly, candidate: nextCandidate };
}

const templates: Record<DirectorDecision['contentType'], NarrativeRole[]> = {
  tutorial: ['hook', 'context', 'argument', 'proof', 'cta'],
  knowledge: ['hook', 'context', 'argument', 'proof', 'cta'],
  product: ['hook', 'context', 'proof', 'argument', 'cta'],
  story: ['hook', 'context', 'argument', 'turn', 'proof', 'cta'],
  other: ['hook', 'context', 'argument', 'proof', 'cta'],
};

export function applySourceStoryTemplate(assembly: SourceStoryAssembly, contentType: DirectorDecision['contentType']): SourceStoryAssembly {
  const template = templates[contentType];
  const last = Math.max(1, assembly.items.length - 1);
  return {
    ...assembly,
    items: assembly.items.map((item, index) => ({ ...item, narrativeRole: template[Math.round(index * (template.length - 1) / last)] })),
    confirmedAt: undefined,
    preview: undefined,
  };
}

export function sourceStoryStructureFingerprint(assembly: SourceStoryAssembly, sources: ExternalMediaSource[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return JSON.stringify(assembly.items.map((item) => {
    const source = sourceById.get(item.sourceId);
    const candidate = source?.roughCutPlan?.candidates.find((entry) => entry.id === item.candidateId);
    return [item.sourceId, item.candidateId, candidate?.start ?? null, candidate?.end ?? null, item.narrativeRole ?? '', source?.path ?? ''];
  }));
}

export function sourceStoryAssemblyReadiness(assembly: SourceStoryAssembly, sources: ExternalMediaSource[], directorUpdatedAt: string) {
  const resolved = resolveSourceStoryAssembly(assembly, sources);
  const missingItems = assembly.items.length - resolved.length;
  const missingRoles = assembly.items.filter((item) => !item.narrativeRole).length;
  const eligibleSources = sources.filter((source) => source.roughCutPlan && acceptedRoughCutCandidates(source.roughCutPlan).length);
  const signaturesStale = eligibleSources.length !== Object.keys(assembly.sourceSignatures).length
    || eligibleSources.some((source) => assembly.sourceSignatures[source.id] !== sourceRoughCutSignature(source));
  const directorStale = assembly.directorUpdatedAt !== directorUpdatedAt;
  const unchecked = resolved.filter((item) => item.candidate.visualReview?.status !== 'approved');
  const duplicates: StoryDuplicateWarning[] = [];
  for (let left = 0; left < resolved.length; left += 1) {
    for (let right = left + 1; right < resolved.length; right += 1) {
      if (resolved[left].source.id === resolved[right].source.id) continue;
      const similarity = textSimilarity(resolved[left].candidate.text, resolved[right].candidate.text);
      if (similarity >= 0.72) duplicates.push({ left: resolved[left], right: resolved[right], similarity });
    }
  }
  const sourceCount = new Set(resolved.map((item) => item.source.id)).size;
  const duration = resolved.reduce((sum, item) => sum + item.candidate.end - item.candidate.start, 0);
  const structureFingerprint = sourceStoryStructureFingerprint(assembly, sources);
  const previewCurrent = Boolean(assembly.preview && assembly.preview.structureFingerprint === structureFingerprint);
  const previewReviewed = previewCurrent && Boolean(assembly.preview?.reviewedAt)
    && Boolean(assembly.preview?.boundaries.every((boundary) => boundary.status === 'approved'));
  const complete = assembly.items.length > 0 && !missingItems && !missingRoles && !signaturesStale && !directorStale;
  return {
    resolved, missingItems, missingRoles, signaturesStale, directorStale, unchecked, duplicates, sourceCount, duration,
    complete, structureFingerprint, previewCurrent, previewReviewed,
    ready: complete && Boolean(assembly.confirmedAt) && unchecked.length === 0 && previewReviewed && !assembly.appliedBlockIds?.length,
  };
}

export function refreshSourceStoryAssembly(assembly: SourceStoryAssembly, sources: ExternalMediaSource[], director: DirectorDecision): SourceStoryAssembly {
  const fresh = createSourceStoryAssembly(sources, director);
  const previous = new Map(assembly.items.map((item) => [`${item.sourceId}:${item.candidateId}`, item]));
  const freshKeys = new Set(fresh.items.map((item) => `${item.sourceId}:${item.candidateId}`));
  const retained = assembly.items.filter((item) => freshKeys.has(`${item.sourceId}:${item.candidateId}`));
  const added = fresh.items.filter((item) => !previous.has(`${item.sourceId}:${item.candidateId}`));
  return {
    ...fresh,
    items: [...retained, ...added].map((item) => ({ ...item, narrativeRole: previous.get(`${item.sourceId}:${item.candidateId}`)?.narrativeRole ?? item.narrativeRole })),
    preview: undefined,
  };
}

export function confirmSourceStoryAssembly(assembly: SourceStoryAssembly, sources: ExternalMediaSource[], directorUpdatedAt: string, now = new Date()) {
  const readiness = sourceStoryAssemblyReadiness(assembly, sources, directorUpdatedAt);
  if (!readiness.complete) throw new Error('请先同步全部保留片段，并为每段指定全局叙事职责。');
  return { ...assembly, confirmedAt: now.toISOString() };
}
