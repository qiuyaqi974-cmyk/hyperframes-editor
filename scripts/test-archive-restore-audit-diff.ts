import assert from 'node:assert/strict';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { createProjectArchive, createSelectiveProjectArchive, previewProjectArchive, type ExistingArchiveCollections } from '../src/lib/projectArchive';
import { createArchiveRestoreAudit, readVerifiedArchiveRestoreAuditText } from '../src/lib/archiveRestoreAudit';
import { archiveRestoreAuditDiffToHtml, createArchiveRestoreAuditDiff } from '../src/lib/archiveRestoreAuditDiff';

const project = scenePlanToSnapshot({ projectName: '恢复审计版本对比', scenes: [{ id: 's1', duration: 4, blocks: [{ type: 'text', content: '对比', duration: 4 }] }] } satisfies ScenePlan);
project.sourceMedia = [{ id: 'source-diff', name: 'source.mp4', path: 'D:\\media\\source.mp4', duration: 10, width: 1920, height: 1080, size: 100, status: 'original', createdAt: '2026-09-01T00:00:00.000Z' }];
const candidate = createReleaseCandidate(project, [], new Date('2026-09-02T00:00:00.000Z'));
const included: ExistingArchiveCollections = { releaseCandidates: [candidate], postPublishObservations: [], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [] };
const empty: ExistingArchiveCollections = { releaseCandidates: [], postPublishObservations: [], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [] };
const archive = await createProjectArchive({ project, ...included }, [{ path: project.sourceMedia[0].path, status: 'available', size: 100, quickSha256: 'source-sha' }], new Date('2026-09-20T00:00:00.000Z'));
const verifiedPreview = await previewProjectArchive(archive, '当前工程', empty, [{ path: project.sourceMedia[0].path, status: 'available', size: 100, quickSha256: 'source-sha' }]);
const changedPreview = await previewProjectArchive(archive, '当前工程', included, [{ path: project.sourceMedia[0].path, status: 'available', size: 100, quickSha256: 'changed-sha' }]);
const left = await createArchiveRestoreAudit(verifiedPreview, empty, new Date('2026-09-20T01:00:00.000Z'));
const right = await createArchiveRestoreAudit(changedPreview, included, new Date('2026-09-20T02:00:00.000Z'));
const before = JSON.stringify({ left, right });
const same = await createArchiveRestoreAuditDiff(left, structuredClone(left));
assert.equal(same.summary.added, 0); assert.equal(same.summary.removed, 0); assert.equal(same.summary.changed, 0); assert(same.summary.identical > 0);
const diff = await createArchiveRestoreAuditDiff(left, right, new Date('2026-09-20T03:00:00.000Z'));
assert(diff.sections.records.items.some((item) => item.status === 'changed' && item.changes.some((change) => change.field === 'status')));
assert(diff.sections.capacities.items.some((item) => item.status === 'changed'));
assert.equal(diff.sections.sources.items.find((item) => item.id === 'source-diff')?.status, 'changed');
assert(diff.sections.findings.items.some((item) => item.status === 'changed'));
assert.equal(diff.archiveMatch.id, true); assert.equal(diff.archiveMatch.version, true); assert.equal(diff.archiveMatch.disclosureMode, true);
assert(Object.values(diff.manifest.sections).every((item) => item.sha256.length === 64 && item.bytes > 0)); assert.equal(diff.manifest.comparisonSha256.length, 64);
assert.match(diff.statement, /不恢复工程/); assert.match(diff.statement, /不判断/);
assert.equal(JSON.stringify({ left, right }), before); assert(!JSON.stringify(diff).includes('D:\\private'));

const minimalArchive = await createSelectiveProjectArchive({ project, ...included }, { publicationEvidence: false, directorLearning: false, batchAudit: false }, false, [], new Date('2026-09-20T04:00:00.000Z'));
const minimalPreview = await previewProjectArchive(minimalArchive, '当前工程', empty, [{ path: project.sourceMedia[0].path, status: 'missing' }]);
const minimal = await createArchiveRestoreAudit(minimalPreview, empty, new Date('2026-09-20T05:00:00.000Z'));
const crossArchive = await createArchiveRestoreAuditDiff(minimal, left);
assert(crossArchive.summary.added > 0); assert(crossArchive.summary.removed > 0);
assert(crossArchive.sections.omissions.items.some((item) => item.status === 'removed'));
assert.equal(crossArchive.archiveMatch.id, false); assert.equal(crossArchive.archiveMatch.version, false); assert.equal(crossArchive.archiveMatch.disclosureMode, false);
assert.equal(crossArchive.warnings.length, 3);

const later = await createArchiveRestoreAuditDiff(left, right, new Date('2027-01-01T00:00:00.000Z'));
assert.equal(later.manifest.comparisonSha256, diff.manifest.comparisonSha256); assert.equal(later.id, diff.id);
const html = archiveRestoreAuditDiffToHtml(diff); assert(!/https?:\/\//.test(html));
const embedded = html.match(/<script id="archive-restore-audit-diff-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
assert(embedded); assert.deepEqual(JSON.parse(embedded), diff);
const loaded = await readVerifiedArchiveRestoreAuditText(JSON.stringify(left), 'json'); assert.equal(loaded.verification.status, 'verified'); assert.equal(loaded.report?.id, left.id);
const tampered = structuredClone(right); tampered.summary.newRecords += 1;
await assert.rejects(() => createArchiveRestoreAuditDiff(left, tampered), /右侧恢复差异审计未通过独立验证/);

console.log('Archive restore audit diff checks passed: verified-only inputs, identical/add/remove/change, records, omissions, capacities, sources, findings, archive metadata warnings, stable hashes, JSON/HTML parity and read-only behavior.');
