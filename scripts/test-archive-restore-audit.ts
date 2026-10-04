import assert from 'node:assert/strict';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { createPostPublishObservation } from '../src/lib/postPublishFeedback';
import type { PostPublishBatchSession } from '../src/lib/postPublishBatchSession';
import {
  createProjectArchive,
  createSelectiveProjectArchive,
  previewProjectArchive,
  type ExistingArchiveCollections,
  type ProjectArchive,
  type ProjectArchiveCreateSections,
} from '../src/lib/projectArchive';
import { ARCHIVE_RESTORE_AUDIT_FORMAT, archiveRestoreAuditToHtml, createArchiveRestoreAudit } from '../src/lib/archiveRestoreAudit';

const project = scenePlanToSnapshot({ projectName: '恢复差异审计', scenes: [{ id: 's1', duration: 5, blocks: [{ type: 'text', content: '审计', duration: 5 }] }] } satisfies ScenePlan);
project.sourceMedia = [
  { id: 'source-ok', name: 'ok.mp4', path: 'D:\\media\\ok.mp4', duration: 10, width: 1920, height: 1080, size: 100, status: 'original', createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'source-changed', name: 'changed.mp4', path: 'D:\\media\\changed.mp4', duration: 20, width: 1920, height: 1080, size: 200, status: 'original', createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'source-missing', name: 'missing.mp4', path: 'D:\\media\\missing.mp4', duration: 30, width: 1920, height: 1080, size: 300, status: 'missing', createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'source-unverified', name: 'unverified.mp4', path: 'D:\\media\\unverified.mp4', duration: 40, width: 1920, height: 1080, size: 400, status: 'original', createdAt: '2026-09-01T00:00:00.000Z' },
];
const candidate = createReleaseCandidate(project, [], new Date('2026-09-02T00:00:00.000Z'));
candidate.render = { outputPath: 'D:\\private\\final.mp4', reportPath: 'D:\\private\\final.json', sha256: 'render-audit-sha', renderedAt: '2026-09-02T01:00:00.000Z' };
const observation = createPostPublishObservation({ rcId: candidate.id, source: { kind: 'manual-entry', platform: 'B站', accountLabel: '审计账号', postUrl: 'BV-audit' }, publishedAt: '2026-09-03T00:00:00.000Z', observedAt: '2026-09-04T00:00:00.000Z', metrics: { views: 100, retention: [] } }, [candidate], new Date('2026-09-04T01:00:00.000Z'));
const template = { id: 'template-audit', name: '审计模板', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', format: 'csv' as const, headers: ['id'], mappings: [{ sourceField: 'id', targetField: 'contentId' as const, unit: 'text' as const }], platform: 'B站', accountLabel: '审计账号' };
const session: PostPublishBatchSession = { id: 'batch-audit', createdAt: '2026-09-04T00:00:00.000Z', sourceFileName: 'audit.csv', sourceFileSha256: 'source-file-sha', format: 'csv', template, confirmedAt: '2026-09-04T00:00:00.000Z', rows: [{ rowIndex: 2, observationId: observation.id, rcId: candidate.id, renderSha256: candidate.render.sha256, contentId: observation.source.postUrl, publishedAt: observation.publishedAt, observedAt: observation.observedAt }] };
const sections: ProjectArchiveCreateSections = { project, releaseCandidates: [candidate], postPublishObservations: [observation], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [session], postPublishBatchRollbacks: [] };
const archiveInspections = [
  { path: project.sourceMedia[0].path, status: 'available' as const, size: 100, quickSha256: 'ok-sha' },
  { path: project.sourceMedia[1].path, status: 'available' as const, size: 200, quickSha256: 'changed-original-sha' },
  { path: project.sourceMedia[2].path, status: 'missing' as const },
  { path: project.sourceMedia[3].path, status: 'available' as const, size: 400 },
];
const currentInspections = [
  { path: project.sourceMedia[0].path, status: 'available' as const, size: 100, quickSha256: 'ok-sha' },
  { path: project.sourceMedia[1].path, status: 'available' as const, size: 200, quickSha256: 'changed-now-sha' },
  { path: project.sourceMedia[2].path, status: 'missing' as const },
  { path: project.sourceMedia[3].path, status: 'available' as const, size: 400 },
];
const archiveV2 = await createProjectArchive(sections, archiveInspections, new Date('2026-09-20T00:00:00.000Z'));
const localObservation = structuredClone(observation); localObservation.metrics.views = 999;
const existing: ExistingArchiveCollections = { releaseCandidates: [structuredClone(candidate)], postPublishObservations: [localObservation], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [] };
const before = JSON.stringify({ archiveV2, existing });
const previewV2 = await previewProjectArchive(archiveV2, '当前工程', existing, currentInspections, new Date('2026-09-20T01:00:00.000Z'));
assert.equal(previewV2.integrity, 'verified');
const report = await createArchiveRestoreAudit(previewV2, existing, new Date('2026-09-20T02:00:00.000Z'), ['source-missing']);
assert.equal(report.format, ARCHIVE_RESTORE_AUDIT_FORMAT);
assert.equal(report.archive.version, 2); assert.equal(report.archive.disclosureMode, 'legacy-full');
assert.equal(report.summary.identicalRecords, 1); assert.equal(report.summary.conflicts, 1); assert.equal(report.summary.newRecords, 1);
assert.equal(report.sections.collections.find((item) => item.name === 'releaseCandidates')?.items[0].status, 'identical');
assert.equal(report.sections.collections.find((item) => item.name === 'postPublishObservations')?.items[0].status, 'conflict');
assert.equal(report.sections.collections.find((item) => item.name === 'postPublishBatchSessions')?.items[0].status, 'new');
assert.deepEqual(report.summary.sourceStatuses, { verified: 1, 'available-unverified': 1, missing: 0, changed: 1, 'pending-relocation': 1 });
assert.equal(report.manifest.auditSha256.length, 64);
assert(Object.values(report.manifest.sections).every((item) => item.sha256.length === 64 && item.bytes > 0));
assert.equal(JSON.stringify({ archiveV2, existing }), before, 'audit generation must not mutate archive or local collections');
assert(!JSON.stringify(report).includes('D:\\private\\final.mp4'), 'report must not copy RC media paths');

const html = archiveRestoreAuditToHtml(report);
assert(html.startsWith('<!doctype html>')); assert(!/https?:\/\//.test(html));
const embedded = html.match(/<script id="archive-restore-audit-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
assert(embedded);
const decoded = embedded.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
assert.deepEqual(JSON.parse(decoded), report, 'JSON and self-contained HTML must embed the same report');

const capacityExisting: ExistingArchiveCollections = { ...existing, releaseCandidates: Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(candidate), id: `local-${index}` })) };
const capacityPreview = await previewProjectArchive(archiveV2, '当前工程', capacityExisting, currentInspections);
const capacityReport = await createArchiveRestoreAudit(capacityPreview, capacityExisting);
assert.equal(capacityReport.summary.capacityRisks, 1);
assert.equal(capacityReport.sections.capacities.find((item) => item.collection === 'releaseCandidates')?.status, 'over-limit');

const minimalV3 = await createSelectiveProjectArchive(sections, { publicationEvidence: false, directorLearning: false, batchAudit: false }, false, archiveInspections, new Date('2026-09-20T03:00:00.000Z'));
const minimalPreview = await previewProjectArchive(minimalV3, '当前工程', existing, currentInspections);
const minimalReport = await createArchiveRestoreAudit(minimalPreview, existing);
assert.equal(minimalReport.archive.version, 3); assert.equal(minimalReport.archive.disclosureMode, 'minimal');
assert(minimalReport.summary.intentionallyOmittedRecords >= 3);
assert(minimalReport.sections.omissions.some((item) => item.collection === 'releaseCandidates' && item.reason.includes('主动省略')));

function canonicalize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}
async function digest(value: unknown) {
  const encoded = new TextEncoder().encode(canonicalize(value));
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return { bytes: encoded.byteLength, sha256: [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('') };
}
const archiveV1 = structuredClone(archiveV2) as ProjectArchive;
archiveV1.version = 1; delete archiveV1.sections.postPublishBatchSessions; delete archiveV1.sections.postPublishBatchRollbacks;
delete archiveV1.manifest.sections.postPublishBatchSessions; delete archiveV1.manifest.sections.postPublishBatchRollbacks;
archiveV1.manifest.sections.archiveMetadata = await digest({ format: archiveV1.format, version: 1, id: archiveV1.id, createdAt: archiveV1.createdAt, projectName: archiveV1.projectName, policy: archiveV1.policy });
const previewV1 = await previewProjectArchive(archiveV1, '当前工程', existing, currentInspections);
const reportV1 = await createArchiveRestoreAudit(previewV1, existing);
assert.equal(reportV1.archive.version, 1); assert.equal(reportV1.archive.disclosureMode, 'legacy-full');
assert.equal(reportV1.sections.collections.find((item) => item.name === 'postPublishBatchSessions')?.incoming, 0);

const tampered = structuredClone(archiveV2); tampered.sections.project.projectName = 'tampered';
const failedPreview = await previewProjectArchive(tampered, '当前工程', existing, currentInspections);
assert.equal(failedPreview.integrity, 'failed');
await assert.rejects(() => createArchiveRestoreAudit(failedPreview, existing), /完整性未通过/);

console.log('Archive restore audit checks passed: v1/v2/v3, new/identical/conflict/omitted records, capacity risk, source states, integrity gate, stable hashes, JSON/HTML parity and read-only behavior.');
