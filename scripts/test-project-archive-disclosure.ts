import assert from 'node:assert/strict';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { createPostPublishObservation } from '../src/lib/postPublishFeedback';
import {
  createProjectArchive, createSelectiveProjectArchive, parseProjectArchive, planProjectArchiveDisclosure, previewProjectArchive,
  type ExistingArchiveCollections, type ProjectArchiveCreateSections,
} from '../src/lib/projectArchive';
import type { PostPublishBatchSession } from '../src/lib/postPublishBatchSession';

const project = scenePlanToSnapshot({ projectName: '最小披露工程', scenes: [{ id: 's1', duration: 6, blocks: [{ type: 'text', content: '披露', duration: 6 }] }] } satisfies ScenePlan);
const candidate = createReleaseCandidate(project, [], new Date('2026-09-01T00:00:00.000Z'));
candidate.render = { outputPath: 'final.mp4', reportPath: 'final.json', sha256: 'render-sha', renderedAt: '2026-09-01T01:00:00.000Z' };
const observation = createPostPublishObservation({ rcId: candidate.id, source: { kind: 'manual-entry', platform: 'B站', accountLabel: '账号', postUrl: 'BV-disclosure' }, publishedAt: '2026-09-02T00:00:00.000Z', observedAt: '2026-09-03T00:00:00.000Z', metrics: { views: 100, retention: [] } }, [candidate], new Date('2026-09-03T01:00:00.000Z'));
const experiment = { id: 'experiment-1', leftObservationId: observation.id, rightObservationId: observation.id, leftRcId: candidate.id, rightRcId: candidate.id, leftRenderSha256: candidate.render.sha256, rightRenderSha256: candidate.render.sha256, conclusion: '描述性测试', confirmedAt: '2026-09-04T00:00:00.000Z' } as ProjectArchiveCreateSections['postPublishExperiments'][number];
const learning = { id: 'learning-1', sourceKind: 'accepted-insight', summary: '人工结论', provenance: { observationIds: [observation.id], rcIds: [candidate.id], renderSha256: [candidate.render.sha256], sourceConfirmedAt: '2026-09-04T00:00:00.000Z' }, scope: { platforms: ['B站'], contentTypes: [], audiences: [], projects: [], topics: [] } } as ProjectArchiveCreateSections['directorLearning'][number];
const template = { id: 'template-1', name: '模板', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', format: 'csv' as const, headers: ['id'], mappings: [{ sourceField: 'id', targetField: 'contentId' as const, unit: 'text' as const }], platform: 'B站', accountLabel: '账号' };
const session: PostPublishBatchSession = { id: 'batch-1', createdAt: '2026-09-03T00:00:00.000Z', sourceFileName: 'data.csv', sourceFileSha256: 'file-sha', format: 'csv', template, confirmedAt: '2026-09-03T00:00:00.000Z', rows: [{ rowIndex: 2, observationId: observation.id, rcId: candidate.id, renderSha256: candidate.render.sha256, contentId: observation.source.postUrl, publishedAt: observation.publishedAt, observedAt: observation.observedAt }] };
const sections: ProjectArchiveCreateSections = { project, releaseCandidates: [candidate], postPublishObservations: [observation], postPublishExperiments: [experiment], directorLearning: [learning], postPublishBatchSessions: [session], postPublishBatchRollbacks: [] };
const before = JSON.stringify(sections);

const minimal = planProjectArchiveDisclosure(sections, { publicationEvidence: false, directorLearning: false, batchAudit: false });
assert.equal(minimal.policy.mode, 'minimal');
assert.deepEqual(minimal.policy.included, { releaseCandidates: 0, postPublishObservations: 0, postPublishExperiments: 0, directorLearning: 0, postPublishBatchSessions: 0, postPublishBatchRollbacks: 0 });
assert.equal(minimal.requiresDependencyAcceptance, false);
assert.equal(minimal.blockers.length, 0);

const learningPlan = planProjectArchiveDisclosure(sections, { publicationEvidence: false, directorLearning: true, batchAudit: false });
assert.equal(learningPlan.policy.included.directorLearning, 1);
assert.equal(learningPlan.policy.included.postPublishObservations, 1);
assert.equal(learningPlan.policy.included.releaseCandidates, 1);
assert.equal(learningPlan.policy.dependencyClosureAdded.postPublishObservations, 1);
assert.equal(learningPlan.requiresDependencyAcceptance, true);
await assert.rejects(() => createSelectiveProjectArchive(sections, learningPlan.selection, false), /接受依赖闭包/);

const batchPlan = planProjectArchiveDisclosure(sections, { publicationEvidence: false, directorLearning: false, batchAudit: true });
assert.equal(batchPlan.policy.included.postPublishBatchSessions, 1);
assert.equal(batchPlan.policy.included.postPublishObservations, 1);
assert.equal(batchPlan.policy.included.releaseCandidates, 1);
assert.equal(batchPlan.requiresDependencyAcceptance, true);

const fullPlan = planProjectArchiveDisclosure(sections, { publicationEvidence: true, directorLearning: true, batchAudit: true });
assert.equal(fullPlan.policy.mode, 'full');
assert.equal(fullPlan.blockers.length, 0);
assert.deepEqual(fullPlan.policy.omittedDomains, []);
assert.equal(JSON.stringify(sections), before, 'disclosure planning must not mutate stored evidence');

const archive = await createSelectiveProjectArchive(sections, minimal.selection, false, [], new Date('2026-09-20T00:00:00.000Z'));
assert.equal(archive.version, 3);
assert.equal(archive.disclosure?.mode, 'minimal');
assert.equal(archive.manifest.sections.disclosurePolicy?.sha256.length, 64);
assert.equal(archive.sections.releaseCandidates.length, 0);
assert.deepEqual(parseProjectArchive(JSON.stringify(archive)), archive);
const empty: ExistingArchiveCollections = { releaseCandidates: [], postPublishObservations: [], postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [] };
let preview = await previewProjectArchive(archive, '当前工程', empty);
assert.equal(preview.integrity, 'verified'); assert.equal(preview.blockers.length, 0);
assert(preview.warnings.some((item) => item.includes('最小披露') && item.includes('主动排除')));

const tampered = structuredClone(archive); tampered.disclosure!.omittedDomains = [];
preview = await previewProjectArchive(tampered, '当前工程', empty);
assert.equal(preview.integrity, 'failed'); assert(preview.blockers.some((item) => item.includes('disclosurePolicy')));

const legacyV2 = await createProjectArchive(sections, [], new Date('2026-09-20T01:00:00.000Z'));
assert.equal(legacyV2.version, 2);
assert.equal(parseProjectArchive(JSON.stringify(legacyV2)).version, 2);
preview = await previewProjectArchive(legacyV2, '当前工程', empty);
assert.equal(preview.integrity, 'verified'); assert.equal(preview.counts.postPublishObservations, 1);

const broken = structuredClone(sections); broken.postPublishObservations = [];
const brokenPlan = planProjectArchiveDisclosure(broken, { publicationEvidence: false, directorLearning: true, batchAudit: false });
assert(brokenPlan.blockers.some((item) => item.includes('发布观察') && item.includes('缺失')));
await assert.rejects(() => createSelectiveProjectArchive(broken, brokenPlan.selection, true), /阻断项/);

console.log('Project archive disclosure checks passed: minimal/custom/full planning, dependency closure and acceptance gate, broken relation blocking, hashed v3 policy, intentional omission preview and v2 recovery compatibility.');
