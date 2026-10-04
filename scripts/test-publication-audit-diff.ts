import assert from 'node:assert/strict';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { createPostPublishObservation } from '../src/lib/postPublishFeedback';
import type { PostPublishBatchRollback, PostPublishBatchSession } from '../src/lib/postPublishBatchSession';
import { createPublicationAuditReport, publicationAuditReportToHtml, readVerifiedPublicationAuditText, type PublicationAuditReport } from '../src/lib/publicationAuditReport';
import { createPublicationAuditDiff, publicationAuditDiffToHtml } from '../src/lib/publicationAuditDiff';

const snapshot = scenePlanToSnapshot({ projectName: '审计版本比较', scenes: [{ id: 's1', duration: 5, blocks: [{ type: 'text', content: '比较', duration: 5 }] }] } satisfies ScenePlan);
snapshot.sourceMedia = [{ id: 'private', name: 'private.mp4', path: 'D:\\private\\source.mp4', duration: 10, width: 1920, height: 1080, size: 100, status: 'original', createdAt: '2026-09-01T00:00:00.000Z' }];
const candidate = createReleaseCandidate(snapshot, [], new Date('2026-09-02T00:00:00.000Z'));
candidate.render = { outputPath: 'D:\\private\\final.mp4', reportPath: 'D:\\private\\report.json', sha256: 'render-diff-sha', renderedAt: '2026-09-02T01:00:00.000Z' };
const observation = createPostPublishObservation({ rcId: candidate.id, source: { kind: 'manual-entry', platform: 'B站', accountLabel: '版本账号', postUrl: 'BV-diff' }, publishedAt: '2026-09-03T00:00:00.000Z', observedAt: '2026-09-04T00:00:00.000Z', metrics: { views: 100, retention: [] } }, [candidate], new Date('2026-09-04T01:00:00.000Z'));
const template = { id: 'diff-template', name: '比较模板', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', format: 'csv' as const, headers: ['id'], mappings: [{ sourceField: 'id', targetField: 'contentId' as const, unit: 'text' as const }], platform: 'B站', accountLabel: '版本账号' };
const active: PostPublishBatchSession = { id: 'batch-active', createdAt: '2026-09-04T00:00:00.000Z', sourceFileName: 'left.csv', sourceFileSha256: 'left-file-sha', format: 'csv', template, confirmedAt: '2026-09-04T00:00:00.000Z', rows: [{ rowIndex: 2, observationId: observation.id, rcId: candidate.id, renderSha256: candidate.render.sha256, contentId: observation.source.postUrl, publishedAt: observation.publishedAt, observedAt: observation.observedAt }] };
const rolled: PostPublishBatchSession = { ...structuredClone(active), id: 'batch-rolled', sourceFileName: 'rolled.csv', rows: [{ ...active.rows[0], observationId: 'rolled-observation' }] };
const rollback: PostPublishBatchRollback = { id: 'rollback-left', sessionId: rolled.id, rolledBackAt: '2026-09-05T00:00:00.000Z', reason: '左侧回滚', observationIds: ['rolled-observation'] };

const leftInput = { snapshot, candidate, evidence: { candidates: [candidate], observations: [observation], experiments: [], learningRecords: [] }, batchSessions: [active, rolled], batchRollbacks: [rollback] };
const left = await createPublicationAuditReport(leftInput, new Date('2026-09-20T00:00:00.000Z'));
const identical = await createPublicationAuditDiff(left, structuredClone(left), new Date('2026-09-20T01:00:00.000Z'));
assert.equal(identical.summary.added, 0); assert.equal(identical.summary.removed, 0); assert.equal(identical.summary.changed, 0); assert(identical.summary.identical > 0);

const changedCandidate = structuredClone(candidate); changedCandidate.label = '右侧 RC 标签';
const changedObservation = structuredClone(observation); changedObservation.rcLabel = changedCandidate.label; changedObservation.metrics.views = 250;
const addedObservation = structuredClone(changedObservation); addedObservation.id = 'observation-added'; addedObservation.source.postUrl = 'BV-added';
const changedActive = structuredClone(active); changedActive.sourceFileName = 'right.csv'; changedActive.sourceFileSha256 = 'right-file-sha';
const addedSession = structuredClone(active); addedSession.id = 'batch-added'; addedSession.sourceFileName = 'added.csv'; addedSession.rows = [{ ...active.rows[0], observationId: 'missing-right-observation' }];
const rightInput = { snapshot, candidate: changedCandidate, evidence: { candidates: [changedCandidate], observations: [changedObservation, addedObservation], experiments: [], learningRecords: [] }, batchSessions: [changedActive, addedSession], batchRollbacks: [] };
const right = await createPublicationAuditReport(rightInput, new Date('2026-09-20T02:00:00.000Z'));
const before = JSON.stringify({ left, right });
const diff = await createPublicationAuditDiff(left, right, new Date('2026-09-20T03:00:00.000Z'));
assert(diff.summary.added > 0); assert(diff.summary.removed > 0); assert(diff.summary.changed > 0); assert(diff.summary.identical > 0);
assert(diff.sections.lineageNodes.items.some((item) => item.status === 'changed' && item.changes.length > 0));
assert(diff.sections.lineageEdges.items.some((item) => item.status === 'added' || item.status === 'removed'), 'relation endpoint changes must appear as stable edge additions/removals');
assert.equal(diff.sections.batchSessions.items.find((item) => item.id === active.id)?.status, 'changed');
assert.equal(diff.sections.batchSessions.items.find((item) => item.id === rolled.id)?.status, 'removed');
assert.equal(diff.sections.batchSessions.items.find((item) => item.id === addedSession.id)?.status, 'added');
assert.equal(diff.sections.batchRollbacks.items.find((item) => item.id === rollback.id)?.status, 'removed');
assert(diff.sections.issues.items.some((item) => item.status === 'changed'));
assert(Object.values(diff.manifest.sections).every((item) => item.sha256.length === 64 && item.bytes > 0));
assert.equal(diff.manifest.comparisonSha256.length, 64);
assert.match(diff.statement, /不推断因果/); assert.match(diff.statement, /不判定/);
assert.equal(JSON.stringify({ left, right }), before, 'comparison must not mutate either report');
assert(!JSON.stringify(diff).includes('D:\\private'), 'comparison must not reintroduce omitted media or render paths');

const later = await createPublicationAuditDiff(left, right, new Date('2027-01-01T00:00:00.000Z'));
assert.equal(later.manifest.comparisonSha256, diff.manifest.comparisonSha256, 'generation time must not affect comparison hash');
assert.equal(later.id, diff.id);

const otherScope = structuredClone(right); otherScope.scope = '另一个已验证审计范围';
const scopeDiff = await createPublicationAuditDiff(left, otherScope);
assert.equal(scopeDiff.scopeMatch, false); assert(scopeDiff.warnings.some((item) => item.includes('范围不同')));

const html = publicationAuditDiffToHtml(diff);
assert(!/https?:\/\//.test(html)); assert(!html.includes('D:\\private'));
const embedded = html.match(/<script id="publication-audit-diff-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
assert(embedded); assert.deepEqual(JSON.parse(embedded), diff, 'JSON and HTML must contain the same diff report');

const leftHtml = publicationAuditReportToHtml(left);
const loadedJson = await readVerifiedPublicationAuditText(JSON.stringify(left), 'json');
const loadedHtml = await readVerifiedPublicationAuditText(leftHtml, 'html');
assert.equal(loadedJson.verification.status, 'verified'); assert.equal(loadedJson.report?.manifest.evidenceSha256, left.manifest.evidenceSha256);
assert.equal(loadedHtml.verification.status, 'verified'); assert.equal(loadedHtml.report?.manifest.evidenceSha256, left.manifest.evidenceSha256);

const tampered = structuredClone(right); tampered.summary.nodes += 1;
await assert.rejects(() => createPublicationAuditDiff(left, tampered), /右侧报告未通过独立验证/);
const unknown = structuredClone(right) as PublicationAuditReport & { futureCritical?: boolean }; unknown.futureCritical = true;
await assert.rejects(() => createPublicationAuditDiff(left, unknown), /未知关键字段/);

console.log('Publication audit diff checks passed: verified-only inputs, identical/add/remove/change, field diffs, relation endpoints, batches, rollbacks, issues, scope warnings, stable hashes, JSON/HTML parity and read-only behavior.');
