import assert from 'node:assert/strict';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { createPostPublishObservation } from '../src/lib/postPublishFeedback';
import { createPublicationAuditReport, publicationAuditFileType, publicationAuditReportToHtml, verifyPublicationAuditText } from '../src/lib/publicationAuditReport';
import type { PostPublishBatchRollback, PostPublishBatchSession } from '../src/lib/postPublishBatchSession';

const plan: ScenePlan = { projectName: '审计工程', scenes: [{ id: 's1', duration: 5, blocks: [{ type: 'text', content: '审计', duration: 5 }] }] };
const snapshot = scenePlanToSnapshot(plan);
snapshot.sourceMedia = [{ id: 'private-source', name: 'private.mp4', path: 'D:\\secret\\private.mp4', proxyPath: 'D:\\secret\\proxy.mp4', duration: 10, width: 1920, height: 1080, size: 100, status: 'proxy-ready', createdAt: '2026-09-01T00:00:00.000Z', transcription: { backend: 'faster-whisper', model: 'small', language: 'zh', generatedAt: '2026-09-01T00:00:00.000Z', segments: [{ start: 0, end: 1, text: '绝密转写全文' }] } }];
const candidate = createReleaseCandidate(snapshot, [], new Date('2026-09-02T00:00:00.000Z'));
candidate.render = { outputPath: 'D:\\secret\\final.mp4', reportPath: 'D:\\secret\\render.json', sha256: 'render-sha256', renderedAt: '2026-09-02T01:00:00.000Z' };
const observation = createPostPublishObservation({ rcId: candidate.id, source: { kind: 'manual-entry', platform: 'B站', accountLabel: '账号 A', postUrl: 'BV-audit' }, publishedAt: '2026-09-03T00:00:00.000Z', observedAt: '2026-09-04T00:00:00.000Z', metrics: { views: 1000, retention: [] } }, [candidate], new Date('2026-09-04T01:00:00.000Z'));
const template = { id: 'audit-template', name: '审计模板', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', format: 'csv' as const, headers: ['内容ID'], mappings: [{ sourceField: '内容ID', targetField: 'contentId' as const, unit: 'text' as const }], platform: 'B站', accountLabel: '账号 A' };
const active: PostPublishBatchSession = { id: 'batch-active', createdAt: '2026-09-04T00:00:00.000Z', sourceFileName: 'audit.csv', sourceFileSha256: 'file-sha-active', format: 'csv', template, confirmedAt: '2026-09-04T00:00:00.000Z', rows: [{ rowIndex: 2, observationId: observation.id, rcId: candidate.id, renderSha256: candidate.render.sha256, contentId: observation.source.postUrl, publishedAt: observation.publishedAt, observedAt: observation.observedAt }] };
const rolled: PostPublishBatchSession = { ...structuredClone(active), id: 'batch-rolled', sourceFileName: 'rolled.csv', sourceFileSha256: 'file-sha-rolled', rows: [{ ...active.rows[0], observationId: 'rolled-observation', contentId: 'BV-rolled' }] };
const rollback: PostPublishBatchRollback = { id: 'rollback-1', sessionId: rolled.id, rolledBackAt: '2026-09-05T00:00:00.000Z', reason: '误导入。', observationIds: ['rolled-observation'] };
const input = { snapshot, candidate, evidence: { candidates: [candidate], observations: [observation], experiments: [], learningRecords: [] }, batchSessions: [rolled, active], batchRollbacks: [rollback] };
const before = JSON.stringify(input);
const report = await createPublicationAuditReport(input, new Date('2026-09-20T00:00:00.000Z'));
assert.equal(report.summary.batchSessions, 2);
assert.equal(report.summary.batchRollbacks, 1);
assert.equal(report.sections.batchSessions.find((item) => item.id === rolled.id)?.status, 'rolled-back');
assert.equal(report.issues.batchIntegrity.length, 0);
assert.equal(report.manifest.evidenceSha256.length, 64);
assert(Object.values(report.manifest.sections).every((item) => item.sha256.length === 64 && item.bytes > 0));
assert.equal(JSON.stringify(input), before, 'audit generation must not mutate source records');

const reordered = await createPublicationAuditReport({ ...input, evidence: { ...input.evidence, candidates: [...input.evidence.candidates].reverse(), observations: [...input.evidence.observations].reverse() }, batchSessions: [...input.batchSessions].reverse() }, new Date('2027-01-01T00:00:00.000Z'));
assert.equal(reordered.manifest.evidenceSha256, report.manifest.evidenceSha256, 'generation time and input order must not change evidence hash');
assert.equal(reordered.id, report.id);
assert.notEqual(reordered.generatedAt, report.generatedAt);

const resurrected = structuredClone(observation); resurrected.id = 'rolled-observation';
const damaged = await createPublicationAuditReport({ ...input, evidence: { ...input.evidence, observations: [observation, structuredClone(observation), resurrected] }, batchSessions: [active, rolled, { ...structuredClone(active), id: 'batch-other' }] });
assert(damaged.issues.duplicateIds.some((item) => item.includes('重复')));
assert(damaged.issues.missingSources.length > 0);
assert(damaged.issues.batchIntegrity.some((item) => item.includes('仍存在')));
assert(damaged.issues.batchIntegrity.some((item) => item.includes('同时归属')));

const hashConflict = structuredClone(observation); hashConflict.renderSha256 = 'conflicting-render-sha';
const conflicted = await createPublicationAuditReport({ ...input, evidence: { ...input.evidence, observations: [hashConflict] } });
assert(conflicted.issues.hashConflicts.some((item) => item.includes('哈希')));

const serialized = JSON.stringify(report);
assert(!serialized.includes('D:\\secret'));
assert(!serialized.includes('绝密转写全文'));
assert(!serialized.includes('sourceMedia'));
assert(!serialized.includes('proxyPath'));
assert(serialized.includes('已省略本机路径'));
const html = publicationAuditReportToHtml(report);
assert(!html.includes('D:\\secret'));
assert(!html.includes('绝密转写全文'));
assert(!/https?:\/\//.test(html), 'offline HTML must not depend on remote assets');
const embedded = html.match(/<script id="publication-audit-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
assert(embedded);
assert.equal(JSON.parse(embedded).manifest.evidenceSha256, report.manifest.evidenceSha256);
assert(html.includes(report.manifest.evidenceSha256));

const reportJson = JSON.stringify(report);
const verifiedJson = await verifyPublicationAuditText(reportJson, 'json');
assert.equal(verifiedJson.status, 'verified');
assert(verifiedJson.sections.every((item) => item.status === 'verified'));
assert.equal(verifiedJson.evidence.status, 'verified');
const verifiedHtml = await verifyPublicationAuditText(html, 'html');
assert.equal(verifiedHtml.status, 'verified');
assert.equal(verifiedHtml.fileType, 'html');

const escapedPayload = reportJson.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapedHtml = `<html><body><script type="application/json" id="publication-audit-data">${escapedPayload}</script></body></html>`;
assert.equal((await verifyPublicationAuditText(escapedHtml, 'html')).status, 'verified');

const sectionTampered = structuredClone(report); sectionTampered.summary.nodes += 1;
const sectionResult = await verifyPublicationAuditText(JSON.stringify(sectionTampered), 'json');
assert.equal(sectionResult.status, 'failed');
assert.equal(sectionResult.sections.find((item) => item.name === 'summary')?.status, 'tampered');
assert.equal(sectionResult.evidence.status, 'tampered');
const totalTampered = structuredClone(report); totalTampered.manifest.evidenceSha256 = '0'.repeat(64);
const totalResult = await verifyPublicationAuditText(JSON.stringify(totalTampered), 'json');
assert.equal(totalResult.status, 'failed'); assert(totalResult.sections.every((item) => item.status === 'verified')); assert.equal(totalResult.evidence.status, 'tampered');
const missing = structuredClone(report) as unknown as Record<string, any>; delete missing.sections.lineage;
const missingResult = await verifyPublicationAuditText(JSON.stringify(missing), 'json');
assert.equal(missingResult.sections.find((item) => item.name === 'lineage')?.status, 'missing');
const unsupported = structuredClone(report) as unknown as Record<string, any>; unsupported.version = 99; unsupported.futureCritical = true;
const unsupportedResult = await verifyPublicationAuditText(JSON.stringify(unsupported), 'json');
assert.equal(unsupportedResult.status, 'unsupported'); assert(unsupportedResult.unknownFields.includes('futureCritical'));
const doubledHtml = `${html}<script id="publication-audit-data" type="application/json">${reportJson}</script>`;
assert((await verifyPublicationAuditText(doubledHtml, 'html')).errors.some((item) => item.includes('多个')));
assert((await verifyPublicationAuditText('<html></html>', 'html')).errors.some((item) => item.includes('缺少')));
assert.equal(publicationAuditFileType('report.audit.json'), 'json'); assert.equal(publicationAuditFileType('report.audit.html'), 'html');
assert.throws(() => publicationAuditFileType('report.txt'), /只支持/);
assert.equal(JSON.stringify(report), reportJson, 'verification must not mutate the report');

console.log('Publication audit checks passed: stable hashes, privacy boundary, JSON/HTML verification, escaped payloads, section/total tampering, missing data, unsupported fields/version and read-only generation.');
