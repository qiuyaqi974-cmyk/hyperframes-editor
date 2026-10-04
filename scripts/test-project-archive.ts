import assert from 'node:assert/strict';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { createPostPublishObservation, decidePostPublishInsight } from '../src/lib/postPublishFeedback';
import type { PostPublishBatchRollback, PostPublishBatchSession } from '../src/lib/postPublishBatchSession';
import {
  createProjectArchive,
  createRecoveredProjectSnapshot,
  confirmArchiveSourceRelocation,
  parseProjectArchive,
  previewProjectArchive,
  reviewArchiveSourceRelocation,
  validateArchiveSourceRelocations,
  type ExistingArchiveCollections,
} from '../src/lib/projectArchive';

const plan: ScenePlan = { projectName: '可移植归档', scenes: [{ id: 's1', duration: 8, blocks: [{ type: 'text', content: '归档', duration: 8 }] }] };
const project = scenePlanToSnapshot(plan);
project.sourceMedia = [{
  id: 'source-1', name: 'source.mp4', path: 'D:\\media\\source.mp4', proxyPath: 'D:\\cache\\source-proxy.mp4',
  duration: 120, width: 1920, height: 1080, size: 4096, status: 'proxy-ready', createdAt: '2026-09-01T00:00:00.000Z',
  transcription: { backend: 'faster-whisper', model: 'small', language: 'zh', generatedAt: '2026-09-01T01:00:00.000Z', sourceFingerprint: 'transcription-source-fingerprint', wordTimestamps: true },
}];
const candidate = createReleaseCandidate(project, [], new Date('2026-09-02T00:00:00.000Z'));
candidate.render = { outputPath: 'D:\\renders\\final.mp4', reportPath: 'D:\\renders\\final.json', sha256: 'final-sha256', renderedAt: '2026-09-02T01:00:00.000Z' };
let observation = createPostPublishObservation({
  rcId: candidate.id, source: { kind: 'manual-entry', platform: 'B站', accountLabel: '归档账号', postUrl: 'BV-archive' },
  publishedAt: '2026-09-03T00:00:00.000Z', observedAt: '2026-09-04T00:00:00.000Z', metrics: { completionRate: 52, retention: [{ second: 3, rate: 70 }] },
}, [candidate], new Date('2026-09-04T01:00:00.000Z'));
observation = decidePostPublishInsight(observation, 'completion', 'accepted', '归档测试人工确认。', true, new Date('2026-09-04T02:00:00.000Z'));
const template = {
  id: 'template-archive', name: '归档映射', createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
  format: 'csv' as const, headers: ['内容ID'], mappings: [{ sourceField: '内容ID', targetField: 'contentId' as const, unit: 'text' as const }], platform: 'B站', accountLabel: '归档账号',
};
const activeSession: PostPublishBatchSession = {
  id: 'post-batch-active', createdAt: '2026-09-04T00:00:00.000Z', sourceFileName: 'active.csv', sourceFileSha256: 'active-file-sha256', format: 'csv', template, confirmedAt: '2026-09-04T00:00:00.000Z',
  rows: [{ rowIndex: 2, observationId: observation.id, rcId: candidate.id, renderSha256: candidate.render.sha256, contentId: observation.source.postUrl, publishedAt: observation.publishedAt, observedAt: observation.observedAt }],
};
const rolledSession: PostPublishBatchSession = {
  ...structuredClone(activeSession), id: 'post-batch-rolled', sourceFileName: 'rolled.csv', sourceFileSha256: 'rolled-file-sha256',
  rows: [{ ...activeSession.rows[0], observationId: 'post-observation-rolled', contentId: 'BV-rolled' }],
};
const rollback: PostPublishBatchRollback = { id: 'post-batch-rollback-1', sessionId: rolledSession.id, rolledBackAt: '2026-09-05T00:00:00.000Z', reason: '测试整批撤销。', observationIds: ['post-observation-rolled'] };
const sections = { project, releaseCandidates: [candidate], postPublishObservations: [observation], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [activeSession, rolledSession], postPublishBatchRollbacks: [rollback] };
const sourceInspection = { path: project.sourceMedia[0].path, status: 'available' as const, size: 4096, mtimeMs: 123, quickSha256: 'quick-source-hash' };
const archive = await createProjectArchive(sections, [sourceInspection], new Date('2026-09-20T00:00:00.000Z'));

assert.equal(archive.policy.includesOriginalMedia, false);
assert.equal(archive.version, 2);
assert.equal(archive.sections.postPublishBatchSessions?.length, 2);
assert.equal(archive.sections.postPublishBatchRollbacks?.length, 1);
assert(archive.manifest.sections.postPublishBatchSessions?.sha256);
assert(archive.manifest.sections.postPublishBatchRollbacks?.sha256);
assert.equal(archive.policy.preservesAbsolutePaths, true);
assert.equal(archive.sourceReferences[0].path, 'D:\\media\\source.mp4');
assert.equal(archive.sourceReferences[0].quickSha256, 'quick-source-hash');
assert.equal(archive.sourceReferences[0].transcriptionFingerprint, 'transcription-source-fingerprint');
assert(Object.values(archive.manifest.sections).every((item) => item.sha256.length === 64 && item.bytes > 0));
assert.deepEqual(parseProjectArchive(JSON.stringify(archive)), archive);

const empty: ExistingArchiveCollections = { releaseCandidates: [], postPublishObservations: [], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [] };
const sourceBefore = JSON.stringify(archive);
let preview = await previewProjectArchive(archive, '正在编辑的工程', empty, [sourceInspection], new Date('2026-09-20T01:00:00.000Z'));
assert.equal(preview.integrity, 'verified');
assert.equal(preview.blockers.length, 0);
assert.equal(preview.sourceResults[0].restoreStatus, 'verified');
assert.equal(preview.counts.postPublishBatchSessions, 2);
assert.equal(preview.counts.postPublishBatchRollbacks, 1);
const recovered = createRecoveredProjectSnapshot(preview, new Date('2026-09-20T02:00:00.000Z'));
assert.match(recovered.projectName, /归档恢复副本/);
assert.equal(recovered.sourceMedia?.[0].path, 'D:\\media\\source.mp4');
assert.equal(recovered.sourceMedia?.[0].proxyPath, 'D:\\cache\\source-proxy.mp4');
assert.equal(JSON.stringify(archive), sourceBefore, 'preview and recovery must not mutate the archive');

preview = await previewProjectArchive(archive, '当前工程', empty, [{ ...sourceInspection, quickSha256: 'wrong-hash' }]);
assert.equal(preview.sourceResults[0].restoreStatus, 'changed');
assert(preview.warnings.some((item) => item.includes('错版')));
const changedSourceProject = createRecoveredProjectSnapshot(preview);
assert.equal(changedSourceProject.sourceMedia?.[0].status, 'missing');
assert.equal(changedSourceProject.sourceMedia?.[0].path, 'D:\\media\\source.mp4');

preview = await previewProjectArchive(archive, '当前工程', empty, [{ path: sourceInspection.path, status: 'missing' }]);
assert.equal(preview.sourceResults[0].restoreStatus, 'missing');
assert.equal(preview.blockers.length, 0, 'offline media is explicit but does not destroy recoverable project data');
const matchingCandidate = { path: 'E:\\relocated\\source.mp4', status: 'available' as const, size: 4096, mtimeMs: 456, quickSha256: 'quick-source-hash', duration: 120, width: 1920, height: 1080 };
const relocationReview = reviewArchiveSourceRelocation(preview.sourceResults[0], matchingCandidate);
assert.deepEqual(relocationReview.comparison, { size: 'match', duration: 'match', quickSha256: 'match' });
assert.deepEqual(relocationReview.blockers, []);
assert.throws(() => confirmArchiveSourceRelocation(relocationReview, false), /人工确认/);
const relocation = confirmArchiveSourceRelocation(relocationReview, true, new Date('2026-09-20T02:30:00.000Z'));
validateArchiveSourceRelocations(preview, [relocation], [matchingCandidate]);
const relocated = createRecoveredProjectSnapshot(preview, new Date('2026-09-20T03:00:00.000Z'), [relocation]);
assert.equal(relocated.sourceMedia?.[0].path, matchingCandidate.path);
assert.equal(relocated.sourceMedia?.[0].status, 'original');
assert.equal(relocated.sourceMedia?.[0].proxyPath, undefined, 'old-machine proxy is not carried into a relocated source');
assert.equal(archive.sections.project.sourceMedia?.[0].path, 'D:\\media\\source.mp4', 'relocation never rewrites archive content');
const wrongSize = reviewArchiveSourceRelocation(preview.sourceResults[0], { ...matchingCandidate, size: 5000 });
assert(wrongSize.blockers.some((item) => item.includes('大小不一致')));
const wrongDuration = reviewArchiveSourceRelocation(preview.sourceResults[0], { ...matchingCandidate, duration: 130 });
assert(wrongDuration.blockers.some((item) => item.includes('时长不一致')));
const wrongHash = reviewArchiveSourceRelocation(preview.sourceResults[0], { ...matchingCandidate, quickSha256: 'wrong' });
assert(wrongHash.blockers.some((item) => item.includes('快速哈希')));
assert.throws(() => confirmArchiveSourceRelocation(wrongHash, true), /凭证不一致/);
assert.throws(() => validateArchiveSourceRelocations(preview, [relocation], [{ ...matchingCandidate, quickSha256: 'changed-after-confirmation' }]), /确认后发生变化/);
const metadataReview = reviewArchiveSourceRelocation({ ...preview.sourceResults[0], quickSha256: undefined }, { ...matchingCandidate, quickSha256: undefined });
assert.equal(metadataReview.comparison.quickSha256, 'unavailable');
assert(metadataReview.warnings.some((item) => item.includes('只能按文件大小和视频时长')));

const conflicting = structuredClone(candidate);
conflicting.label = '同 ID 的本机不同 RC';
preview = await previewProjectArchive(archive, '当前工程', { ...empty, releaseCandidates: [conflicting] }, [sourceInspection]);
assert(preview.blockers.some((item) => item.includes('同 ID')));
assert.throws(() => createRecoveredProjectSnapshot(preview), /阻断/);

const tampered = structuredClone(archive);
tampered.sections.project.projectName = '被篡改';
preview = await previewProjectArchive(tampered, '当前工程', empty, [sourceInspection]);
assert.equal(preview.integrity, 'failed');
assert(preview.blockers.some((item) => item.includes('project')));

const metadataTampered = structuredClone(archive);
metadataTampered.createdAt = '2030-01-01T00:00:00.000Z';
preview = await previewProjectArchive(metadataTampered, '当前工程', empty, [sourceInspection]);
assert.equal(preview.integrity, 'failed');
assert(preview.blockers.some((item) => item.includes('archiveMetadata')));

const batchTampered = structuredClone(archive);
batchTampered.sections.postPublishBatchSessions![0].sourceFileName = 'tampered.csv';
preview = await previewProjectArchive(batchTampered, '当前工程', empty, [sourceInspection]);
assert.equal(preview.integrity, 'failed');
assert(preview.blockers.some((item) => item.includes('postPublishBatchSessions')));

const brokenActiveArchive = await createProjectArchive({ ...sections, postPublishObservations: [], postPublishBatchSessions: [activeSession], postPublishBatchRollbacks: [] });
preview = await previewProjectArchive(brokenActiveArchive, '当前工程', empty);
assert(preview.blockers.some((item) => item.includes('未包含在归档中')));

const orphanRollbackArchive = await createProjectArchive({ ...sections, postPublishObservations: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [rollback] });
preview = await previewProjectArchive(orphanRollbackArchive, '当前工程', empty);
assert(preview.blockers.some((item) => item.includes('批次会话') && item.includes('缺失')));

const partialRollbackArchive = await createProjectArchive({ ...sections, postPublishObservations: [], postPublishBatchSessions: [rolledSession], postPublishBatchRollbacks: [{ ...rollback, observationIds: [] }] });
preview = await previewProjectArchive(partialRollbackArchive, '当前工程', empty);
assert(preview.blockers.some((item) => item.includes('未完整对应')));

const resurrected = structuredClone(observation);
resurrected.id = rolledSession.rows[0].observationId;
const resurrectedArchive = await createProjectArchive({ ...sections, postPublishObservations: [observation, resurrected] });
preview = await previewProjectArchive(resurrectedArchive, '当前工程', empty);
assert(preview.blockers.some((item) => item.includes('静默复活')));

const conflictingSession = structuredClone(activeSession);
conflictingSession.sourceFileName = 'local-conflict.csv';
preview = await previewProjectArchive(archive, '当前工程', { ...empty, postPublishBatchSessions: [conflictingSession] }, [sourceInspection]);
assert(preview.blockers.some((item) => item.includes('批次会话') && item.includes('同 ID')));

const existingSessions = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(activeSession), id: `existing-session-${index}`, rows: [] }));
preview = await previewProjectArchive(archive, '当前工程', { ...empty, postPublishBatchSessions: existingSessions }, [sourceInspection]);
assert(preview.blockers.some((item) => item.includes('批次会话合并后') && item.includes('安全上限 100')));

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
const legacy = structuredClone(archive);
legacy.version = 1;
delete legacy.sections.postPublishBatchSessions;
delete legacy.sections.postPublishBatchRollbacks;
delete legacy.manifest.sections.postPublishBatchSessions;
delete legacy.manifest.sections.postPublishBatchRollbacks;
legacy.manifest.sections.archiveMetadata = await digest({ format: legacy.format, version: 1, id: legacy.id, createdAt: legacy.createdAt, projectName: legacy.projectName, policy: legacy.policy });
const parsedLegacy = parseProjectArchive(JSON.stringify(legacy));
preview = await previewProjectArchive(parsedLegacy, '当前工程', empty, [sourceInspection]);
assert.equal(preview.integrity, 'verified');
assert.equal(preview.blockers.length, 0);
assert.equal(preview.counts.postPublishBatchSessions, 0);
assert.equal(preview.counts.postPublishBatchRollbacks, 0);
assert(preview.warnings.some((item) => item.includes('v1') && item.includes('不会补造')));

const twelveCandidates = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(candidate), id: `existing-${index}` }));
preview = await previewProjectArchive(archive, '当前工程', { ...empty, releaseCandidates: twelveCandidates }, [sourceInspection]);
assert(preview.blockers.some((item) => item.includes('安全上限 12')));

assert.throws(() => parseProjectArchive('{"format":"other"}'), /支持/);
console.log('Project archive v2 checks passed: v1 read compatibility, independently hashed batch sessions and rollback receipts, relationship/resurrection/conflict/capacity gates, media relocation and recovery copies.');
