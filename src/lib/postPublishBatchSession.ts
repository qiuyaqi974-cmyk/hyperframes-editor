import type { DirectorLearningApplication } from '@/types';
import type { DirectorLearningRecord } from '@/lib/directorLearningLibrary';
import type { PlatformExportFormat, PlatformMappingTemplate } from '@/lib/platformDataAdapter';
import type { PostPublishExperimentReview } from '@/lib/postPublishExperiment';
import type { PostPublishObservation } from '@/lib/postPublishFeedback';

export interface PostPublishBatchSessionDraft {
  sourceFileName: string;
  sourceFileSha256: string;
  format: PlatformExportFormat;
  template: PlatformMappingTemplate;
  confirmedAt: string;
}

export interface PostPublishBatchSession {
  id: string;
  createdAt: string;
  sourceFileName: string;
  sourceFileSha256: string;
  format: PlatformExportFormat;
  template: PlatformMappingTemplate;
  confirmedAt: string;
  rows: Array<{
    rowIndex: number;
    observationId: string;
    rcId: string;
    renderSha256: string;
    contentId: string;
    publishedAt: string;
    observedAt: string;
  }>;
}

export interface PostPublishBatchRollback {
  id: string;
  sessionId: string;
  rolledBackAt: string;
  reason: string;
  observationIds: string[];
}

export interface PostPublishBatchRollbackPreview {
  session: PostPublishBatchSession;
  status: 'ready' | 'blocked' | 'rolled-back';
  blockers: string[];
  impact: {
    observationIds: string[];
    acceptedInsights: string[];
    experimentIds: string[];
    learningRecordIds: string[];
    briefProposalIds: string[];
  };
}

export function createPostPublishBatchSession(observations: PostPublishObservation[], draft: PostPublishBatchSessionDraft, existing: PostPublishBatchSession[] = [], now = new Date()): PostPublishBatchSession {
  if (!observations.length) throw new Error('批次会话必须包含至少一条发布观察。');
  if (!draft.template?.id || !draft.sourceFileName.trim() || !draft.sourceFileSha256.trim() || !draft.confirmedAt) throw new Error('批次会话缺少文件、模板或确认凭证。');
  const observationIds = observations.map((item) => item.id);
  if (new Set(observationIds).size !== observationIds.length) throw new Error('批次包含重复观察 ID。');
  const rows = observations.map((observation) => {
    const receipt = observation.source.mappingReceipt;
    if (observation.source.kind !== 'platform-export' || !receipt) throw new Error(`观察 ${observation.id} 缺少平台行级映射回执。`);
    if (observation.source.sourceFileName !== draft.sourceFileName || observation.source.sourceFileSha256 !== draft.sourceFileSha256) throw new Error(`观察 ${observation.id} 的源文件凭证与批次不一致。`);
    if (receipt.confirmedAt !== draft.confirmedAt) throw new Error(`观察 ${observation.id} 的确认时间与批次不一致。`);
    return {
      rowIndex: receipt.rowIndex,
      observationId: observation.id,
      rcId: observation.rcId,
      renderSha256: observation.renderSha256,
      contentId: observation.source.postUrl,
      publishedAt: observation.publishedAt,
      observedAt: observation.observedAt,
    };
  });
  if (new Set(rows.map((item) => item.rowIndex)).size !== rows.length) throw new Error('批次会话包含重复文件行号。');
  const id = `post-batch-${now.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  if (existing.some((item) => item.id === id)) throw new Error('批次会话 ID 冲突，请重试。');
  return {
    id,
    createdAt: now.toISOString(),
    sourceFileName: draft.sourceFileName.trim(),
    sourceFileSha256: draft.sourceFileSha256,
    format: draft.format,
    template: structuredClone(draft.template),
    confirmedAt: draft.confirmedAt,
    rows: rows.sort((a, b) => a.rowIndex - b.rowIndex),
  };
}

export function previewPostPublishBatchRollback(
  session: PostPublishBatchSession,
  sessions: PostPublishBatchSession[],
  rollbacks: PostPublishBatchRollback[],
  observations: PostPublishObservation[],
  experiments: PostPublishExperimentReview[],
  learningRecords: DirectorLearningRecord[],
  applications: DirectorLearningApplication[] = [],
): PostPublishBatchRollbackPreview {
  const observationIds = session.rows.map((item) => item.observationId);
  const idSet = new Set(observationIds);
  const blockers: string[] = [];
  const priorRollback = rollbacks.find((item) => item.sessionId === session.id);
  if (priorRollback) blockers.push(`该批次已于 ${priorRollback.rolledBackAt} 整体撤销，不能重复操作。`);
  if (new Set(observationIds).size !== observationIds.length) blockers.push('批次回执包含重复观察 ID。');
  for (const other of sessions) {
    if (other.id !== session.id && other.rows.some((row) => idSet.has(row.observationId))) blockers.push(`观察同时出现在批次 ${other.id}，归属冲突。`);
  }
  const observationMap = new Map(observations.map((item) => [item.id, item]));
  for (const row of session.rows) {
    const observation = observationMap.get(row.observationId);
    if (!observation) { blockers.push(`批次观察 ${row.observationId} 已缺失，当前不是完整批次状态。`); continue; }
    const receipt = observation.source.mappingReceipt;
    if (observation.rcId !== row.rcId || observation.renderSha256 !== row.renderSha256 || observation.source.postUrl !== row.contentId
      || observation.publishedAt !== row.publishedAt || observation.observedAt !== row.observedAt
      || observation.source.sourceFileSha256 !== session.sourceFileSha256 || receipt?.rowIndex !== row.rowIndex) {
      blockers.push(`批次观察 ${row.observationId} 与不可变会话回执不一致。`);
    }
  }
  const acceptedInsights = observations.flatMap((observation) => idSet.has(observation.id)
    ? observation.insights.filter((item) => item.decision === 'accepted').map((item) => `${observation.id}:${item.id}`) : []);
  const experimentIds = experiments.filter((item) => idSet.has(item.leftObservationId) || idSet.has(item.rightObservationId)).map((item) => item.id);
  const learningRecordIds = learningRecords.filter((item) => item.provenance.observationIds.some((id) => idSet.has(id))).map((item) => item.id);
  const briefProposalIds = [...new Set(applications.filter((application) => application.citations.some((citation) => citation.provenance.observationIds.some((id) => idSet.has(id)))).map((item) => item.proposalId))];
  if (acceptedInsights.length) blockers.push(`${acceptedInsights.length} 条洞察已被人工采纳。`);
  if (experimentIds.length) blockers.push(`${experimentIds.length} 个实验结论引用了该批次。`);
  if (learningRecordIds.length) blockers.push(`${learningRecordIds.length} 条导演学习记录引用了该批次。`);
  if (briefProposalIds.length) blockers.push(`${briefProposalIds.length} 个 Brief 应用引用了该批次。`);
  return {
    session,
    status: priorRollback ? 'rolled-back' : blockers.length ? 'blocked' : 'ready',
    blockers: [...new Set(blockers)],
    impact: { observationIds, acceptedInsights, experimentIds, learningRecordIds, briefProposalIds },
  };
}

export function confirmPostPublishBatchRollback(preview: PostPublishBatchRollbackPreview, confirmed: boolean, reason: string, existing: PostPublishBatchRollback[] = [], now = new Date()): PostPublishBatchRollback {
  if (preview.status !== 'ready' || preview.blockers.length) throw new Error('该批次存在后续证据引用或状态异常，不能回滚。');
  if (!confirmed) throw new Error('请确认影响清单并明确同意整体撤销。');
  const text = reason.trim();
  if (!text) throw new Error('请填写整批撤销原因。');
  if (existing.some((item) => item.sessionId === preview.session.id)) throw new Error('该批次已经回滚。');
  return {
    id: `post-batch-rollback-${now.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    sessionId: preview.session.id,
    rolledBackAt: now.toISOString(),
    reason: text,
    observationIds: [...preview.impact.observationIds],
  };
}
