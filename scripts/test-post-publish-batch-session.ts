import assert from 'node:assert/strict';
import { confirmPostPublishBatchRollback, createPostPublishBatchSession, previewPostPublishBatchRollback } from '../src/lib/postPublishBatchSession';
import type { PostPublishObservation } from '../src/lib/postPublishFeedback';
import type { PlatformMappingTemplate } from '../src/lib/platformDataAdapter';

const template: PlatformMappingTemplate = {
  id: 'template-1', name: 'B站模板', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z',
  format: 'csv', headers: ['作品ID', '发布时间', '观测时间', '播放量'], platform: 'B站', accountLabel: '账号 A',
  mappings: [
    { sourceField: '作品ID', targetField: 'contentId', unit: 'text' },
    { sourceField: '发布时间', targetField: 'publishedAt', unit: 'datetime' },
    { sourceField: '观测时间', targetField: 'observedAt', unit: 'datetime' },
    { sourceField: '播放量', targetField: 'views', unit: 'count' },
  ],
};
const confirmedAt = '2026-09-20T01:00:00.000Z';
const observation = (index: number): PostPublishObservation => ({
  id: `obs-${index}`, rcId: `rc-${index}`, rcLabel: `RC ${index}`, renderSha256: `sha-${index}`,
  source: {
    kind: 'platform-export', platform: 'B站', accountLabel: '账号 A', postUrl: `BV-${index}`, sourceFileName: 'batch.csv', sourceFileSha256: 'file-sha', recordedAt: confirmedAt,
    mappingReceipt: { rowIndex: index, fields: template.mappings.map((item) => ({ sourceField: item.sourceField, targetField: item.targetField, unit: item.unit })), ignoredFields: [], confirmedAt },
  },
  publishedAt: '2026-09-18T00:00:00.000Z', observedAt: '2026-09-19T00:00:00.000Z', windowHours: 24,
  metrics: { views: 1000 + index, retention: [] }, insights: [{ id: 'completion', category: 'pacing', statement: '检查节奏', evidence: '完播率', decision: 'pending' }], createdAt: confirmedAt,
});
const observations = [observation(0), observation(1)];
const draft = { sourceFileName: 'batch.csv', sourceFileSha256: 'file-sha', format: 'csv' as const, template, confirmedAt };
const before = JSON.stringify({ observations, draft });
const session = createPostPublishBatchSession(observations, draft, [], new Date('2026-09-20T02:00:00.000Z'));
assert.equal(session.rows.length, 2);
assert.equal(session.template.id, template.id);
assert.equal(session.rows[1].observationId, 'obs-1');
assert.equal(JSON.stringify({ observations, draft }), before, 'session creation is read-only');
assert.throws(() => createPostPublishBatchSession([observations[0], observations[0]], draft), /重复观察/);
assert.throws(() => createPostPublishBatchSession([{ ...observations[0], source: { ...observations[0].source, sourceFileSha256: 'wrong' } }], draft), /源文件凭证/);

const ready = previewPostPublishBatchRollback(session, [session], [], observations, [], [], []);
assert.equal(ready.status, 'ready');
assert.deepEqual(ready.blockers, []);
assert.throws(() => confirmPostPublishBatchRollback(ready, false, '误导入'), /确认影响/);
assert.throws(() => confirmPostPublishBatchRollback(ready, true, ''), /原因/);
const rollback = confirmPostPublishBatchRollback(ready, true, '选错了平台导出日期', [], new Date('2026-09-20T03:00:00.000Z'));
assert.deepEqual(rollback.observationIds, ['obs-0', 'obs-1']);
assert.equal(previewPostPublishBatchRollback(session, [session], [rollback], [], [], [], []).status, 'rolled-back');

const missing = previewPostPublishBatchRollback(session, [session], [], [observations[0]], [], [], []);
assert(missing.blockers.some((item) => item.includes('已缺失')));
const changed = previewPostPublishBatchRollback(session, [session], [], [{ ...observations[0], renderSha256: 'changed' }, observations[1]], [], [], []);
assert(changed.blockers.some((item) => item.includes('不一致')));
const acceptedObservation = { ...observations[0], insights: [{ ...observations[0].insights[0], decision: 'accepted' as const, decisionReason: '人工采纳', decidedAt: confirmedAt }] };
assert(previewPostPublishBatchRollback(session, [session], [], [acceptedObservation, observations[1]], [], [], []).blockers.some((item) => item.includes('人工采纳')));
const experiment = { id: 'exp-1', leftObservationId: 'obs-0', rightObservationId: 'other' } as never;
assert(previewPostPublishBatchRollback(session, [session], [], observations, [experiment], [], []).impact.experimentIds.includes('exp-1'));
const learning = { id: 'learning-1', provenance: { observationIds: ['obs-1'] } } as never;
assert(previewPostPublishBatchRollback(session, [session], [], observations, [], [learning], []).impact.learningRecordIds.includes('learning-1'));
const application = { proposalId: 'proposal-1', citations: [{ provenance: { observationIds: ['obs-0'] } }] } as never;
assert(previewPostPublishBatchRollback(session, [session], [], observations, [], [], [application]).impact.briefProposalIds.includes('proposal-1'));
const shared = { ...session, id: 'session-2' };
assert(previewPostPublishBatchRollback(session, [session, shared], [], observations, [], [], []).blockers.some((item) => item.includes('归属冲突')));
assert.equal(JSON.stringify({ observations, draft }), before, 'rollback preview is read-only');

console.log('Post-publish batch session checks passed: immutable receipts, complete rollback, explicit confirmation, drift/partial-state guards and accepted insight/experiment/learning/Brief blockers.');
