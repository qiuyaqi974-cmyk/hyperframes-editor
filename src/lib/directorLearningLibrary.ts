import type { PostPublishObservation } from '@/lib/postPublishFeedback';
import type { PostPublishExperimentReview } from '@/lib/postPublishExperiment';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';

export type LearningEvidenceRole = 'unclassified' | 'support' | 'counterexample' | 'context';
export type LearningFreshness = 'fresh' | 'aging' | 'expired';
export type LearningCredentialStatus = 'verified' | 'unavailable' | 'mismatch';

export interface DirectorLearningRecord {
  id: string;
  sourceKind: 'accepted-insight' | 'experiment-review';
  category: string;
  summary: string;
  evidence: string[];
  humanReason: string;
  scope: {
    platforms: string[];
    accounts: string[];
    contentTypes: string[];
    audiences: string[];
    projectNames: string[];
    topics: string[];
  };
  provenance: {
    observationIds: string[];
    rcIds: string[];
    renderSha256: string[];
    sourceConfirmedAt: string;
  };
  capturedAt: string;
  curation?: {
    role: Exclude<LearningEvidenceRole, 'unclassified'>;
    hypothesis: string;
    note: string;
    curatedAt: string;
  };
}

export interface DirectorLearningView extends DirectorLearningRecord {
  ageDays: number;
  freshness: LearningFreshness;
  credentialStatus: LearningCredentialStatus;
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function candidateScope(candidate: ReleaseCandidate | undefined) {
  return {
    contentTypes: unique([candidate?.snapshot.director?.contentType]),
    audiences: unique([candidate?.snapshot.director?.audience]),
    projectNames: unique([candidate?.projectName]),
    topics: unique([candidate?.snapshot.director?.objective, candidate?.snapshot.director?.thesis]),
  };
}

export function synchronizeDirectorLearningRecords(observations: PostPublishObservation[], experiments: PostPublishExperimentReview[], candidates: ReleaseCandidate[], existing: DirectorLearningRecord[], now = new Date()) {
  const records = new Map(existing.map((item) => [item.id, item]));
  for (const observation of observations) {
    const candidate = candidates.find((item) => item.id === observation.rcId && item.render?.sha256 === observation.renderSha256);
    const scope = candidateScope(candidate);
    for (const insight of observation.insights.filter((item) => item.decision === 'accepted' && item.decidedAt)) {
      const id = `learning:insight:${observation.id}:${insight.id}`;
      if (records.has(id)) continue;
      records.set(id, {
        id, sourceKind: 'accepted-insight', category: insight.category, summary: insight.statement,
        evidence: [insight.evidence], humanReason: insight.decisionReason ?? '',
        scope: { platforms: unique([observation.source.platform]), accounts: unique([observation.source.accountLabel]), ...scope },
        provenance: { observationIds: [observation.id], rcIds: [observation.rcId], renderSha256: [observation.renderSha256], sourceConfirmedAt: insight.decidedAt! },
        capturedAt: now.toISOString(),
      });
    }
  }
  for (const experiment of experiments) {
    const id = `learning:experiment:${experiment.id}`;
    if (records.has(id)) continue;
    const leftCandidate = candidates.find((item) => item.id === experiment.leftRcId && item.render?.sha256 === experiment.leftRenderSha256);
    const rightCandidate = candidates.find((item) => item.id === experiment.rightRcId && item.render?.sha256 === experiment.rightRenderSha256);
    const leftScope = candidateScope(leftCandidate);
    const rightScope = candidateScope(rightCandidate);
    const facts = experiment.comparison.facts;
    records.set(id, {
      id, sourceKind: 'experiment-review', category: 'experiment', summary: experiment.conclusion,
      evidence: [
        ...experiment.comparison.metrics.map((item) => `${item.label}：${item.left}${item.unit} → ${item.right}${item.unit}（差值 ${item.delta > 0 ? '+' : ''}${item.delta}${item.unit}）`),
        ...experiment.comparison.warnings.map((item) => `限制：${item}`),
      ],
      humanReason: '已人工确认这是描述性对照，不是因果证明。',
      scope: {
        platforms: unique([facts.left.platform, facts.right.platform]), accounts: unique([facts.left.accountLabel, facts.right.accountLabel]),
        contentTypes: unique([...leftScope.contentTypes, ...rightScope.contentTypes, facts.left.contentType, facts.right.contentType]),
        audiences: unique([...leftScope.audiences, ...rightScope.audiences]), projectNames: unique([facts.left.projectName, facts.right.projectName]), topics: unique([facts.left.topic, facts.right.topic]),
      },
      provenance: {
        observationIds: [experiment.leftObservationId, experiment.rightObservationId], rcIds: [experiment.leftRcId, experiment.rightRcId],
        renderSha256: [experiment.leftRenderSha256, experiment.rightRenderSha256], sourceConfirmedAt: experiment.confirmedAt,
      },
      capturedAt: now.toISOString(),
    });
  }
  return [...records.values()].sort((a, b) => Date.parse(b.provenance.sourceConfirmedAt) - Date.parse(a.provenance.sourceConfirmedAt));
}

function credentialStatus(record: DirectorLearningRecord, observations: PostPublishObservation[], candidates: ReleaseCandidate[]): LearningCredentialStatus {
  const observationMap = new Map(observations.map((item) => [item.id, item]));
  const candidateMap = new Map(candidates.map((item) => [item.id, item]));
  let unavailable = false;
  for (let index = 0; index < record.provenance.rcIds.length; index += 1) {
    const rcId = record.provenance.rcIds[index];
    const hash = record.provenance.renderSha256[index];
    const candidate = candidateMap.get(rcId);
    if (!candidate) unavailable = true;
    else if (candidate.render?.sha256 !== hash) return 'mismatch';
  }
  for (const observationId of record.provenance.observationIds) if (!observationMap.has(observationId)) unavailable = true;
  return unavailable ? 'unavailable' : 'verified';
}

export function directorLearningViews(records: DirectorLearningRecord[], observations: PostPublishObservation[], candidates: ReleaseCandidate[], now = new Date()): DirectorLearningView[] {
  return records.map((record) => {
    const ageDays = Math.max(0, Math.floor((now.getTime() - Date.parse(record.provenance.sourceConfirmedAt)) / 86_400_000));
    const freshness: LearningFreshness = ageDays <= 60 ? 'fresh' : ageDays <= 180 ? 'aging' : 'expired';
    return { ...record, ageDays, freshness, credentialStatus: credentialStatus(record, observations, candidates) };
  });
}

export function curateDirectorLearningRecord(record: DirectorLearningRecord, role: Exclude<LearningEvidenceRole, 'unclassified'>, hypothesis: string, note: string, confirmed: boolean, now = new Date()) {
  if (!confirmed) throw new Error('请先确认你已检查证据来源、适用范围和时效。');
  const hypothesisText = hypothesis.trim();
  const noteText = note.trim();
  if (!['support', 'counterexample', 'context'].includes(role)) throw new Error('未知的证据角色。');
  if (!hypothesisText) throw new Error('请写明这条证据针对的创作假设。');
  if (!noteText) throw new Error('请写明分类理由和适用边界。');
  return { ...record, curation: { role, hypothesis: hypothesisText, note: noteText, curatedAt: now.toISOString() } };
}

export function filterDirectorLearningViews(views: DirectorLearningView[], filters: { query?: string; platform?: string; contentType?: string; freshness?: string; role?: string }) {
  const terms = (filters.query ?? '').normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return views.filter((item) => {
    if (filters.platform && !item.scope.platforms.includes(filters.platform)) return false;
    if (filters.contentType && !item.scope.contentTypes.includes(filters.contentType)) return false;
    if (filters.freshness && item.freshness !== filters.freshness) return false;
    const role = item.curation?.role ?? 'unclassified';
    if (filters.role && role !== filters.role) return false;
    const text = [item.summary, ...item.evidence, item.humanReason, ...Object.values(item.scope).flat(), item.curation?.hypothesis, item.curation?.note].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function groupDirectorLearningHypotheses(records: DirectorLearningRecord[]) {
  const groups = new Map<string, { hypothesis: string; support: number; counterexamples: number; context: number; recordIds: string[] }>();
  for (const record of records) {
    if (!record.curation) continue;
    const key = record.curation.hypothesis.normalize('NFKC').trim().toLocaleLowerCase();
    const group = groups.get(key) ?? { hypothesis: record.curation.hypothesis, support: 0, counterexamples: 0, context: 0, recordIds: [] };
    if (record.curation.role === 'support') group.support += 1;
    else if (record.curation.role === 'counterexample') group.counterexamples += 1;
    else group.context += 1;
    group.recordIds.push(record.id); groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.recordIds.length - a.recordIds.length || a.hypothesis.localeCompare(b.hypothesis));
}
