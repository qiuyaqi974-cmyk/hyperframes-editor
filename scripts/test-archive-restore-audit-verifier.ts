import assert from 'node:assert/strict';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { createProjectArchive, previewProjectArchive, type ExistingArchiveCollections } from '../src/lib/projectArchive';
import { archiveRestoreAuditFileType, archiveRestoreAuditToHtml, createArchiveRestoreAudit, verifyArchiveRestoreAuditText } from '../src/lib/archiveRestoreAudit';

const project = scenePlanToSnapshot({ projectName: '恢复审计&A', scenes: [{ id: 's1', duration: 4, blocks: [{ type: 'text', content: '验证', duration: 4 }] }] } satisfies ScenePlan);
project.sourceMedia = [{ id: 'source-verify', name: 'verify.mp4', path: 'D:\\media\\verify.mp4', duration: 10, width: 1920, height: 1080, size: 100, status: 'original', createdAt: '2026-09-01T00:00:00.000Z' }];
const candidate = createReleaseCandidate(project, [], new Date('2026-09-02T00:00:00.000Z'));
const collections: ExistingArchiveCollections = { releaseCandidates: [candidate], postPublishObservations: [], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [] };
const archive = await createProjectArchive({ project, ...collections }, [{ path: project.sourceMedia[0].path, status: 'available', size: 100, quickSha256: 'verify-source-sha' }], new Date('2026-09-20T00:00:00.000Z'));
const empty: ExistingArchiveCollections = { releaseCandidates: [], postPublishObservations: [], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [] };
const preview = await previewProjectArchive(archive, '当前工程', empty, [{ path: project.sourceMedia[0].path, status: 'available', size: 100, quickSha256: 'verify-source-sha' }]);
const report = await createArchiveRestoreAudit(preview, empty, new Date('2026-09-20T01:00:00.000Z'));
const before = JSON.stringify(report);

const jsonResult = await verifyArchiveRestoreAuditText(JSON.stringify(report), 'json');
assert.equal(jsonResult.status, 'verified'); assert(jsonResult.sections.every((item) => item.status === 'verified')); assert.equal(jsonResult.audit.status, 'verified');
assert.equal(jsonResult.archiveId, archive.id); assert.equal(jsonResult.archiveVersion, 2); assert.equal(jsonResult.disclosureMode, 'legacy-full');

const html = archiveRestoreAuditToHtml(report);
const htmlResult = await verifyArchiveRestoreAuditText(html, 'html');
assert.equal(htmlResult.status, 'verified'); assert.equal(htmlResult.audit.actualSha256, report.manifest.auditSha256);
const escapedPayload = JSON.stringify(report).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapedHtml = `<html><script type="application/json" id="archive-restore-audit-data">${escapedPayload}</script></html>`;
assert.equal((await verifyArchiveRestoreAuditText(escapedHtml, 'html')).status, 'verified');

const sectionTampered = structuredClone(report); sectionTampered.sections.collections[0].newCount += 1;
const sectionResult = await verifyArchiveRestoreAuditText(JSON.stringify(sectionTampered), 'json');
assert.equal(sectionResult.status, 'failed'); assert.equal(sectionResult.sections.find((item) => item.name === 'collections')?.status, 'tampered'); assert.equal(sectionResult.audit.status, 'tampered');
const totalTampered = structuredClone(report); totalTampered.manifest.auditSha256 = '0'.repeat(64);
const totalResult = await verifyArchiveRestoreAuditText(JSON.stringify(totalTampered), 'json');
assert.equal(totalResult.status, 'failed'); assert(totalResult.sections.every((item) => item.status === 'verified')); assert.equal(totalResult.audit.status, 'tampered');
const idTampered = structuredClone(report); idTampered.id = 'restore-audit-wrong';
assert((await verifyArchiveRestoreAuditText(JSON.stringify(idTampered), 'json')).errors.some((item) => item.includes('审计 ID')));

const missing = structuredClone(report) as unknown as Record<string, any>; delete missing.sections.sources;
const missingResult = await verifyArchiveRestoreAuditText(JSON.stringify(missing), 'json');
assert.equal(missingResult.sections.find((item) => item.name === 'sources')?.status, 'missing');
const unknownTop = structuredClone(report) as unknown as Record<string, any>; unknownTop.futureCritical = true;
const unknownTopResult = await verifyArchiveRestoreAuditText(JSON.stringify(unknownTop), 'json');
assert.equal(unknownTopResult.status, 'unsupported'); assert(unknownTopResult.unknownFields.includes('futureCritical'));
const unknownNested = structuredClone(report) as unknown as Record<string, any>; unknownNested.sections.collections[0].futureCount = 1;
const unknownNestedResult = await verifyArchiveRestoreAuditText(JSON.stringify(unknownNested), 'json');
assert.equal(unknownNestedResult.status, 'unsupported'); assert(unknownNestedResult.unknownFields.includes('sections.collections[0].futureCount'));
const unsupported = structuredClone(report) as unknown as Record<string, any>; unsupported.version = 99;
assert.equal((await verifyArchiveRestoreAuditText(JSON.stringify(unsupported), 'json')).status, 'unsupported');

const doubledHtml = `${html}<script id="archive-restore-audit-data" type="application/json">${JSON.stringify(report)}</script>`;
assert((await verifyArchiveRestoreAuditText(doubledHtml, 'html')).errors.some((item) => item.includes('多个')));
assert((await verifyArchiveRestoreAuditText('<html></html>', 'html')).errors.some((item) => item.includes('缺少')));
assert((await verifyArchiveRestoreAuditText('<script id="archive-restore-audit-data" type="text/javascript">{}</script>', 'html')).errors.some((item) => item.includes('application/json')));
assert((await verifyArchiveRestoreAuditText('x'.repeat(10 * 1024 * 1024 + 1), 'json')).errors.some((item) => item.includes('10 MB')));
assert.equal(archiveRestoreAuditFileType('audit.json'), 'json'); assert.equal(archiveRestoreAuditFileType('audit.html'), 'html'); assert.equal(archiveRestoreAuditFileType('audit.htm'), 'html');
assert.throws(() => archiveRestoreAuditFileType('audit.txt'), /只支持/);
assert.equal(JSON.stringify(report), before, 'verification must not mutate the report');

console.log('Archive restore audit verifier checks passed: JSON/HTML and entities, six sections and total hash, ID, tampering, missing/unknown/unsupported data, HTML block and file gates, size limit and read-only behavior.');
