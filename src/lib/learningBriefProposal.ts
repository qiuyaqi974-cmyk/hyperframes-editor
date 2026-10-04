import type { DirectorDecision, DirectorLearningApplication, DirectorLearningCitation } from '@/types';
import type { DirectorLearningView } from '@/lib/directorLearningLibrary';

export type LearningBriefField = 'objective' | 'audience' | 'thesis' | 'contentType' | 'tone' | 'pacing' | 'emotionArc' | 'endingAction' | 'visualRules';

export interface LearningBriefProposal {
  id: string;
  createdAt: string;
  baselineDirectorUpdatedAt: string;
  selectedRecordIds: string[];
  sourceFingerprint: string;
  suggested: Partial<Pick<DirectorDecision, LearningBriefField>>;
  citations: DirectorLearningCitation[];
  blockers: string[];
  warnings: string[];
  requiresExpiredAcknowledgement: boolean;
}

const contentTypes: DirectorDecision['contentType'][] = ['knowledge', 'product', 'story', 'tutorial', 'other'];
const pacingValues: DirectorDecision['pacing'][] = ['calm', 'balanced', 'fast'];

function key(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function fingerprint(views: DirectorLearningView[]) {
  return views.map((item) => [
    item.id, item.provenance.sourceConfirmedAt, ...item.provenance.rcIds, ...item.provenance.renderSha256,
    item.curation?.role ?? '', item.curation?.hypothesis ?? '', item.curation?.curatedAt ?? '', item.credentialStatus, item.freshness,
  ].join('|')).sort().join('\n');
}

function citation(view: DirectorLearningView): DirectorLearningCitation | undefined {
  if (!view.curation || view.credentialStatus !== 'verified') return undefined;
  return {
    recordId: view.id,
    role: view.curation.role,
    freshness: view.freshness,
    credentialStatus: 'verified',
    summary: view.summary,
    hypothesis: view.curation.hypothesis,
    scope: structuredClone(view.scope),
    provenance: structuredClone(view.provenance),
  };
}

export function createLearningBriefProposal(allViews: DirectorLearningView[], selectedRecordIds: string[], director: DirectorDecision, now = new Date()): LearningBriefProposal {
  const selectedSet = new Set(selectedRecordIds);
  const selected = allViews.filter((item) => selectedSet.has(item.id));
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!selected.length) blockers.push('请至少选择一条已经人工分类的学习证据。');
  for (const id of selectedSet) if (!selected.some((item) => item.id === id)) blockers.push(`学习记录 ${id} 已不存在。`);
  for (const item of selected) {
    if (!item.curation) blockers.push(`${item.summary} 尚未分类为支持、反例或背景证据。`);
    if (item.credentialStatus === 'mismatch') blockers.push(`${item.summary} 的 RC 或成片哈希发生冲突。`);
    if (item.credentialStatus === 'unavailable') blockers.push(`${item.summary} 的原观察或 RC 当前不可核验。`);
    if (item.freshness === 'expired') warnings.push(`${item.summary} 已超过 180 天，只能在额外确认后引用。`);
    else if (item.freshness === 'aging') warnings.push(`${item.summary} 已进入证据衰减期。`);
  }
  const support = selected.filter((item) => item.curation?.role === 'support');
  if (!support.length) blockers.push('Brief 建议至少需要一条支持证据；反例和背景不能单独推出修改。');
  const supportHypotheses = unique(support.map((item) => item.curation?.hypothesis ?? ''));
  const relevantKeys = new Set(supportHypotheses.map(key));
  const relatedCounterexamples = allViews.filter((item) => item.curation?.role === 'counterexample' && relevantKeys.has(key(item.curation.hypothesis)));
  for (const counterexample of relatedCounterexamples) {
    if (!selectedSet.has(counterexample.id)) blockers.push(`同一假设存在未纳入的反例：${counterexample.summary}`);
    else if (counterexample.credentialStatus !== 'verified') blockers.push(`已知反例“${counterexample.summary}”当前无法核验，不能据此应用 Brief。`);
  }
  if (supportHypotheses.length > 1) warnings.push(`所选支持证据涉及 ${supportHypotheses.length} 个不同假设，请在建议中收窄表达。`);
  const citations = selected.map(citation).filter((item): item is DirectorLearningCitation => Boolean(item));
  const suggested: LearningBriefProposal['suggested'] = {};
  if (supportHypotheses[0]) suggested.thesis = supportHypotheses.join('；');
  const audiences = unique(support.flatMap((item) => item.scope.audiences));
  if (audiences.length === 1) suggested.audience = audiences[0];
  const types = unique(support.flatMap((item) => item.scope.contentTypes));
  if (types.length === 1 && contentTypes.includes(types[0] as DirectorDecision['contentType'])) suggested.contentType = types[0] as DirectorDecision['contentType'];
  if (Object.keys(suggested).length === 0) blockers.push('所选证据无法形成明确的 Brief 字段建议。');
  if (supportHypotheses[0] === director.thesis && suggested.audience === director.audience && suggested.contentType === director.contentType) warnings.push('生成的建议与当前 Brief 基本一致；应用前请确认是否仍有必要。');
  return {
    id: `learning-brief-${now.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    createdAt: now.toISOString(), baselineDirectorUpdatedAt: director.updatedAt, selectedRecordIds: [...selectedSet],
    sourceFingerprint: fingerprint(selected), suggested, citations, blockers, warnings,
    requiresExpiredAcknowledgement: selected.some((item) => item.freshness === 'expired'),
  };
}

export function applyLearningBriefProposal(
  proposal: LearningBriefProposal,
  currentViews: DirectorLearningView[],
  director: DirectorDecision,
  values: Partial<Pick<DirectorDecision, LearningBriefField>>,
  selectedFields: LearningBriefField[],
  options: { confirmedEvidence: boolean; acknowledgedExpired: boolean; rationale: string },
  now = new Date(),
): Partial<Omit<DirectorDecision, 'scenes' | 'updatedAt'>> {
  if (proposal.blockers.length) throw new Error('当前建议存在阻断项，不能应用。');
  if (director.updatedAt !== proposal.baselineDirectorUpdatedAt) throw new Error('导演 Brief 已在建议生成后变化，请重新生成建议。');
  const currentSelected = currentViews.filter((item) => proposal.selectedRecordIds.includes(item.id));
  if (currentSelected.length !== proposal.selectedRecordIds.length || fingerprint(currentSelected) !== proposal.sourceFingerprint) throw new Error('引用证据已变化，请重新生成建议。');
  if (currentSelected.some((item) => item.credentialStatus !== 'verified')) throw new Error('引用证据当前不可核验或凭证失配。');
  if (!options.confirmedEvidence) throw new Error('请确认你已逐条检查支持、反例、范围和凭证。');
  if ((proposal.requiresExpiredAcknowledgement || currentSelected.some((item) => item.freshness === 'expired')) && !options.acknowledgedExpired) throw new Error('所选证据包含过期记录，请额外确认时效风险。');
  const rationale = options.rationale.trim();
  if (!rationale) throw new Error('请记录为什么这些证据适用于当前工程。');
  const fields = [...new Set(selectedFields)];
  if (!fields.length) throw new Error('请至少逐项确认一个要更新的 Brief 字段。');
  const patch: Partial<Pick<DirectorDecision, LearningBriefField>> = {};
  for (const field of fields) {
    const value = values[field];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 的建议值不能为空。`);
    if (field === 'contentType' && !contentTypes.includes(value as DirectorDecision['contentType'])) throw new Error('未知的内容类型。');
    if (field === 'pacing' && !pacingValues.includes(value as DirectorDecision['pacing'])) throw new Error('未知的节奏类型。');
    (patch as Record<string, unknown>)[field] = value.trim();
  }
  const application: DirectorLearningApplication = {
    proposalId: proposal.id, appliedAt: now.toISOString(), rationale, fields,
    citations: proposal.citations.map((item) => ({ ...structuredClone(item), freshness: currentSelected.find((view) => view.id === item.recordId)?.freshness ?? item.freshness })),
  };
  return { ...patch, learningApplications: [...(director.learningApplications ?? []), application].slice(-50) };
}
