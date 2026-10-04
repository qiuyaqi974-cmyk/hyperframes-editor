import assert from 'node:assert/strict';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createProjectArchive, previewProjectArchive, type ExistingArchiveCollections } from '../src/lib/projectArchive';
import { createArchiveRestoreAudit } from '../src/lib/archiveRestoreAudit';
import { archiveRestoreAuditDiffFileType, archiveRestoreAuditDiffToHtml, createArchiveRestoreAuditDiff, verifyArchiveRestoreAuditDiffText } from '../src/lib/archiveRestoreAuditDiff';

const project = scenePlanToSnapshot({ projectName: '恢复审计对比验证', scenes: [{ id: 's1', duration: 3, blocks: [{ type: 'text', content: '验证', duration: 3 }] }] } satisfies ScenePlan);
project.sourceMedia = [{ id: 'source-verify', name: 'source.mp4', path: 'D:\\media\\source.mp4', duration: 3, width: 1920, height: 1080, size: 88, status: 'original', createdAt: '2026-09-01T00:00:00.000Z' }];
const empty: ExistingArchiveCollections = { releaseCandidates: [], postPublishObservations: [], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [] };
const archive = await createProjectArchive({ project, ...empty }, [{ path: project.sourceMedia[0].path, status: 'available', size: 88, quickSha256: 'left-sha' }], new Date('2026-09-20T00:00:00.000Z'));
const leftPreview = await previewProjectArchive(archive, '当前工程', empty, [{ path: project.sourceMedia[0].path, status: 'available', size: 88, quickSha256: 'left-sha' }]);
const rightPreview = await previewProjectArchive(archive, '当前工程', empty, [{ path: project.sourceMedia[0].path, status: 'available', size: 88, quickSha256: 'right-sha' }]);
const left = await createArchiveRestoreAudit(leftPreview, empty, new Date('2026-09-20T01:00:00.000Z'));
const right = await createArchiveRestoreAudit(rightPreview, empty, new Date('2026-09-20T02:00:00.000Z'));
const report = await createArchiveRestoreAuditDiff(left, right, new Date('2026-09-20T03:00:00.000Z'));
const before = JSON.stringify(report);

const json = await verifyArchiveRestoreAuditDiffText(JSON.stringify(report), 'json');
assert.equal(json.status, 'verified');
assert.equal(json.sections.length, 5);
assert(json.sections.every((section) => section.status === 'verified'));
assert.equal(json.comparison.status, 'verified');
assert.equal(json.left?.id, left.id); assert.equal(json.right?.id, right.id);
assert.equal(json.archiveMatch?.id, true);

const html = archiveRestoreAuditDiffToHtml(report);
const htmlResult = await verifyArchiveRestoreAuditDiffText(html, 'html');
assert.equal(htmlResult.status, 'verified'); assert.equal(htmlResult.comparison.actualSha256, report.manifest.comparisonSha256);
const escapedPayload = JSON.stringify(report).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapedHtml = `<html><script type="application/json" id="archive-restore-audit-diff-data">${escapedPayload}</script></html>`;
assert.equal((await verifyArchiveRestoreAuditDiffText(escapedHtml, 'html')).status, 'verified');

const sectionTamper = structuredClone(report); sectionTamper.sections.sources.summary.changed += 1;
const sectionResult = await verifyArchiveRestoreAuditDiffText(JSON.stringify(sectionTamper), 'json');
assert.equal(sectionResult.status, 'failed'); assert.equal(sectionResult.sections.find((section) => section.name === 'sources')?.status, 'tampered'); assert.equal(sectionResult.comparison.status, 'tampered');
const totalTamper = structuredClone(report); totalTamper.manifest.comparisonSha256 = '0'.repeat(64);
assert.equal((await verifyArchiveRestoreAuditDiffText(JSON.stringify(totalTamper), 'json')).comparison.status, 'tampered');
const missing = structuredClone(report) as Record<string, unknown>; delete (missing.sections as Record<string, unknown>).findings;
assert.equal((await verifyArchiveRestoreAuditDiffText(JSON.stringify(missing), 'json')).sections.find((section) => section.name === 'findings')?.status, 'missing');
const unknownTop = { ...report, futureField: true };
assert.equal((await verifyArchiveRestoreAuditDiffText(JSON.stringify(unknownTop), 'json')).status, 'unsupported');
const unknownNested = structuredClone(report) as typeof report & { sections: typeof report.sections & { sources: typeof report.sections.sources & { future?: boolean } } }; unknownNested.sections.sources.future = true;
assert.equal((await verifyArchiveRestoreAuditDiffText(JSON.stringify(unknownNested), 'json')).status, 'unsupported');
const unsupportedVersion = { ...report, version: 2 };
assert.equal((await verifyArchiveRestoreAuditDiffText(JSON.stringify(unsupportedVersion), 'json')).status, 'unsupported');

const block = html.match(/<script id="archive-restore-audit-diff-data" type="application\/json">[\s\S]*?<\/script>/)?.[0]; assert(block);
assert.match((await verifyArchiveRestoreAuditDiffText(html.replace(block, ''), 'html')).errors.join(' '), /缺少/);
assert.match((await verifyArchiveRestoreAuditDiffText(html.replace('</main>', `${block}</main>`), 'html')).errors.join(' '), /多个/);
assert.match((await verifyArchiveRestoreAuditDiffText(html.replace('type="application/json"', 'type="text/javascript"'), 'html')).errors.join(' '), /不是 application\/json/);
assert.match((await verifyArchiveRestoreAuditDiffText(`{"padding":"${'x'.repeat(10 * 1024 * 1024)}"}`, 'json')).errors.join(' '), /超过 10 MB/);
assert.equal(archiveRestoreAuditDiffFileType('report.JSON'), 'json'); assert.equal(archiveRestoreAuditDiffFileType('report.htm'), 'html'); assert.throws(() => archiveRestoreAuditDiffFileType('report.txt'), /只支持/);
assert.equal(JSON.stringify(report), before);

console.log('Archive restore audit diff verifier checks passed: JSON/HTML, entities, five sections, metadata, total hash, tampering, missing/unknown/version guards, safe script extraction, size/type limits and read-only behavior.');
