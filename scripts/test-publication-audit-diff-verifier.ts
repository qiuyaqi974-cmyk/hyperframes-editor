import assert from 'node:assert/strict';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { createPublicationAuditReport } from '../src/lib/publicationAuditReport';
import { createPublicationAuditDiff, publicationAuditDiffFileType, publicationAuditDiffToHtml, verifyPublicationAuditDiffText } from '../src/lib/publicationAuditDiff';

const snapshot = scenePlanToSnapshot({ projectName: '版本差异&A', scenes: [{ id: 's1', duration: 4, blocks: [{ type: 'text', content: '验证', duration: 4 }] }] } satisfies ScenePlan);
const leftCandidate = createReleaseCandidate(snapshot, [], new Date('2026-09-01T00:00:00.000Z'));
leftCandidate.render = { outputPath: 'D:\\private\\left.mp4', reportPath: 'D:\\private\\left.json', sha256: 'left-render-sha', renderedAt: '2026-09-01T01:00:00.000Z' };
const rightCandidate = structuredClone(leftCandidate); rightCandidate.label = '右侧标签';
const left = await createPublicationAuditReport({ snapshot, candidate: leftCandidate, evidence: { candidates: [leftCandidate], observations: [], experiments: [], learningRecords: [] }, batchSessions: [], batchRollbacks: [] }, new Date('2026-09-20T00:00:00.000Z'));
const right = await createPublicationAuditReport({ snapshot, candidate: rightCandidate, evidence: { candidates: [rightCandidate], observations: [], experiments: [], learningRecords: [] }, batchSessions: [], batchRollbacks: [] }, new Date('2026-09-20T01:00:00.000Z'));
const report = await createPublicationAuditDiff(left, right, new Date('2026-09-20T02:00:00.000Z'));
const before = JSON.stringify(report);

const jsonResult = await verifyPublicationAuditDiffText(JSON.stringify(report), 'json');
assert.equal(jsonResult.status, 'verified'); assert(jsonResult.sections.every((item) => item.status === 'verified')); assert.equal(jsonResult.comparison.status, 'verified');
assert.equal(jsonResult.left?.id, left.id); assert.equal(jsonResult.right?.id, right.id); assert.equal(jsonResult.scopeMatch, report.scopeMatch);

const html = publicationAuditDiffToHtml(report);
const htmlResult = await verifyPublicationAuditDiffText(html, 'html');
assert.equal(htmlResult.status, 'verified'); assert.equal(htmlResult.comparison.actualSha256, report.manifest.comparisonSha256);
const escapedPayload = JSON.stringify(report).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapedHtml = `<html><script type="application/json" id="publication-audit-diff-data">${escapedPayload}</script></html>`;
assert.equal((await verifyPublicationAuditDiffText(escapedHtml, 'html')).status, 'verified');

const sectionTampered = structuredClone(report); sectionTampered.sections.lineageNodes.summary.changed += 1;
const sectionResult = await verifyPublicationAuditDiffText(JSON.stringify(sectionTampered), 'json');
assert.equal(sectionResult.status, 'failed'); assert.equal(sectionResult.sections.find((item) => item.name === 'lineageNodes')?.status, 'tampered'); assert.equal(sectionResult.comparison.status, 'tampered');
const totalTampered = structuredClone(report); totalTampered.manifest.comparisonSha256 = '0'.repeat(64);
const totalResult = await verifyPublicationAuditDiffText(JSON.stringify(totalTampered), 'json');
assert.equal(totalResult.status, 'failed'); assert(totalResult.sections.every((item) => item.status === 'verified')); assert.equal(totalResult.comparison.status, 'tampered');
const idTampered = structuredClone(report); idTampered.id = 'publication-audit-diff-wrong';
assert((await verifyPublicationAuditDiffText(JSON.stringify(idTampered), 'json')).errors.some((item) => item.includes('差异报告 ID')));

const missing = structuredClone(report) as unknown as Record<string, any>; delete missing.sections.issues;
const missingResult = await verifyPublicationAuditDiffText(JSON.stringify(missing), 'json');
assert.equal(missingResult.sections.find((item) => item.name === 'issues')?.status, 'missing');
const unknownTop = structuredClone(report) as unknown as Record<string, any>; unknownTop.futureCritical = true;
const unknownTopResult = await verifyPublicationAuditDiffText(JSON.stringify(unknownTop), 'json');
assert.equal(unknownTopResult.status, 'unsupported'); assert(unknownTopResult.unknownFields.includes('futureCritical'));
const unknownNested = structuredClone(report) as unknown as Record<string, any>; unknownNested.sections.lineageNodes.items[0].futureStatus = true;
const unknownNestedResult = await verifyPublicationAuditDiffText(JSON.stringify(unknownNested), 'json');
assert.equal(unknownNestedResult.status, 'unsupported'); assert(unknownNestedResult.unknownFields.includes('sections.lineageNodes.items[0].futureStatus'));
const unsupported = structuredClone(report) as unknown as Record<string, any>; unsupported.version = 99;
assert.equal((await verifyPublicationAuditDiffText(JSON.stringify(unsupported), 'json')).status, 'unsupported');

const doubledHtml = `${html}<script id="publication-audit-diff-data" type="application/json">${JSON.stringify(report)}</script>`;
assert((await verifyPublicationAuditDiffText(doubledHtml, 'html')).errors.some((item) => item.includes('多个')));
assert((await verifyPublicationAuditDiffText('<html></html>', 'html')).errors.some((item) => item.includes('缺少')));
assert((await verifyPublicationAuditDiffText('<script id="publication-audit-diff-data" type="text/javascript">{}</script>', 'html')).errors.some((item) => item.includes('application/json')));
assert((await verifyPublicationAuditDiffText('x'.repeat(10 * 1024 * 1024 + 1), 'json')).errors.some((item) => item.includes('10 MB')));
assert.equal(publicationAuditDiffFileType('diff.json'), 'json'); assert.equal(publicationAuditDiffFileType('diff.html'), 'html'); assert.equal(publicationAuditDiffFileType('diff.htm'), 'html');
assert.throws(() => publicationAuditDiffFileType('diff.txt'), /只支持/);
assert.equal(JSON.stringify(report), before, 'verification must not mutate the diff report');
assert(!JSON.stringify(report).includes('D:\\private'));

console.log('Publication audit diff verifier checks passed: JSON/HTML and entities, five sections and total hash, metadata and ID, tampering, missing/unknown/unsupported data, HTML/file/size gates and read-only behavior.');
