import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStoryLineage, layoutStoryLineage } from '../src/lib/storyLineage';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { useEditorStore } from '../src/store/editorStore';
import { analyzeProjectHealth } from '../src/lib/projectHealth';
import type { SourceStoryAssemblyVersion } from '../src/types';
import type { PostPublishObservation } from '../src/lib/postPublishFeedback';
import type { PostPublishExperimentReview } from '../src/lib/postPublishExperiment';
import type { DirectorLearningRecord } from '../src/lib/directorLearningLibrary';

const version = (id: string, parent?: string): SourceStoryAssemblyVersion => ({ id, label: `方案 ${id}`, note: '', createdAt: '2026-09-20', signature: id, assembly: { version: 1, generatedAt: '', directorUpdatedAt: '', sourceSignatures: {}, items: [] }, segments: [], ...(parent ? { provenance: { kind: 'external-otio', parentVersionId: parent, fileName: 'refined.otio', importedAt: '2026-09-20' } as const } : {}) });
useEditorStore.getState().addBlock('text');
const snapshot = useEditorStore.getState().exportSnapshot();
assert.equal(analyzeProjectHealth(snapshot).blockers.length, 0, 'fixture without story records has no release blockers');
snapshot.projectName = '血缘测试';
snapshot.storyAssemblyVersions = [version('A'), version('B', 'A'), version('C', 'A')];
snapshot.storyVersionSelection = { winnerVersionId: 'B', comparedVersionIds: ['B', 'C'], rationale: '节奏更清楚', rejectedReasons: { C: '重复' }, selectedAt: '2026-09-20' };
snapshot.externalClipInboxes = [{ id: 'inbox', fileName: 'refined.otio', importedAt: '', parentVersionId: 'A', input: {}, clips: [], savedVersionId: 'B' }, { id: 'pending', fileName: 'pending.json', importedAt: '', parentVersionId: 'B', input: {}, clips: [] }];
const rc = createReleaseCandidate(snapshot);
rc.render = { outputPath: 'D:/output.mp4', reportPath: 'D:/report.json', sha256: 'abc', renderedAt: '2026-09-20' };
const rc2 = createReleaseCandidate({ ...structuredClone(snapshot), projectName: '血缘测试 B' }, [rc], new Date('2026-09-20T01:00:00.000Z'));
rc2.render = { outputPath: 'D:/output-b.mp4', reportPath: 'D:/report-b.json', sha256: 'def', renderedAt: '2026-09-20T02:00:00.000Z' };
const observation = (id: string, target: typeof rc, hash: string, row: number): PostPublishObservation => ({
  id, rcId: target.id, rcLabel: target.label, renderSha256: hash, storyVersionId: target.storyDecision?.versionId,
  source: { kind: 'platform-export', platform: 'B站', accountLabel: '账号 A', postUrl: `BV-${id}`, sourceFileName: 'export.csv', sourceFileSha256: 'file-sha', mappingReceipt: { rowIndex: row, fields: [{ sourceField: '播放量', targetField: 'views', unit: 'count' }], ignoredFields: [], confirmedAt: '2026-09-20T03:00:00.000Z' }, recordedAt: '2026-09-20T03:00:00.000Z' },
  publishedAt: '2026-09-19T00:00:00.000Z', observedAt: '2026-09-20T00:00:00.000Z', windowHours: 24,
  metrics: { views: 1000, retention: [] }, insights: [], createdAt: '2026-09-20T03:00:00.000Z',
});
const obs1 = observation('obs-1', rc, 'abc', 0);
const obs2 = observation('obs-2', rc2, 'def', 1);
const experiment = {
  id: 'exp-1', leftObservationId: obs1.id, rightObservationId: obs2.id, leftRcId: rc.id, rightRcId: rc2.id,
  leftRenderSha256: 'abc', rightRenderSha256: 'def', comparison: { facts: {}, metrics: [], warnings: [] },
  conclusion: 'B 侧描述性指标更高。', confirmedAt: '2026-09-20T04:00:00.000Z', nonCausalAcknowledged: true,
} as unknown as PostPublishExperimentReview;
const learning: DirectorLearningRecord = {
  id: 'learning:experiment:exp-1', sourceKind: 'experiment-review', category: 'experiment', summary: '开场更快可能改善留存', evidence: ['描述性对照'], humanReason: '人工核对',
  scope: { platforms: ['B站'], accounts: ['账号 A'], contentTypes: ['knowledge'], audiences: ['创作者'], projectNames: ['血缘测试'], topics: ['开场'] },
  provenance: { observationIds: [obs1.id, obs2.id], rcIds: [rc.id, rc2.id], renderSha256: ['abc', 'def'], sourceConfirmedAt: '2026-09-20T04:00:00.000Z' },
  capturedAt: '2026-09-20T04:00:00.000Z', curation: { role: 'support', hypothesis: '核心内容应前置', note: '同账号', curatedAt: '2026-09-20T05:00:00.000Z' },
};
const application = { proposalId: 'proposal-1', appliedAt: '2026-09-20T06:00:00.000Z', rationale: '范围一致', fields: ['thesis'], citations: [{ recordId: learning.id, role: 'support' as const, freshness: 'fresh' as const, credentialStatus: 'verified' as const, summary: learning.summary, hypothesis: learning.curation!.hypothesis, scope: structuredClone(learning.scope), provenance: structuredClone(learning.provenance) }] };
snapshot.director!.learningApplications = [application];
rc.snapshot.director!.learningApplications = [structuredClone(application)];
const evidence = { candidates: [rc, rc2], observations: [obs1, obs2], experiments: [experiment], learningRecords: [learning] };
const before = JSON.stringify({ snapshot, rc });
const graph = buildStoryLineage(snapshot, rc, evidence, new Date('2026-09-21T00:00:00.000Z'));
assert(graph.edges.some((e) => e.from === 'version:A' && e.to === 'external:B'));
assert(graph.edges.some((e) => e.from === 'external:B' && e.to === 'version:B'));
assert(graph.edges.some((e) => e.from === 'selection' && e.to === 'rc'));
assert(graph.edges.some((e) => e.from === 'rc' && e.to === 'render'));
assert(graph.edges.some((e) => e.from === 'render' && e.to === 'observation:obs-1'));
assert(graph.edges.some((e) => e.from === 'observation:obs-1' && e.to === 'experiment:exp-1'));
assert(graph.edges.some((e) => e.from === 'experiment:exp-1' && e.to === `learning:${learning.id}`));
assert(graph.edges.some((e) => e.from === `learning:${learning.id}` && e.to === 'application:proposal-1'));
assert(graph.nodes.find((item) => item.id === 'observation:obs-1')?.details.some(([key, value]) => key === '导入行号' && value === '1'));
assert(graph.nodes.find((item) => item.id === 'application:proposal-1')?.details.some(([key, value]) => key === '应用字段' && value === 'thesis'));
assert.equal(graph.nodes.filter((n) => n.id === 'external:B').length, 1);
assert(graph.nodes.find((n) => n.id === 'external:B')?.details.some(([key]) => key === '收件箱 ID'));
assert.equal(graph.warnings.length, 0);
assert.equal(JSON.stringify({ snapshot, rc }), before, 'read-only graph');
const layout = layoutStoryLineage(graph);
assert(layout.find((n) => n.id === 'rc')!.x > layout.find((n) => n.id === 'version:B')!.x);

const other = { ...snapshot, projectName: '另一工程', storyAssemblyVersions: [version('X')], storyVersionSelection: undefined, externalClipInboxes: [] };
assert.deepEqual(buildStoryLineage(other, rc, evidence, new Date('2026-09-21T00:00:00.000Z')), graph, 'RC evidence comes only from frozen snapshot');
assert(!buildStoryLineage(other).nodes.some((n) => n.id === 'rc'));
const missing = buildStoryLineage({ ...snapshot, storyAssemblyVersions: [version('B', 'gone')] });
assert(missing.nodes.some((n) => n.id === 'version:gone' && n.kind === 'missing'));
assert(missing.warnings.length);
const cyclic = buildStoryLineage({ ...snapshot, storyAssemblyVersions: [version('A', 'B'), version('B', 'A')] });
assert(cyclic.warnings.some((w) => w.includes('循环')));
assert.equal(layoutStoryLineage(cyclic).length, cyclic.nodes.length);
const duplicate = buildStoryLineage({ ...snapshot, storyAssemblyVersions: [version('A'), version('A')] });
assert(duplicate.warnings.some((w) => w.includes('重复')));
const legacy = buildStoryLineage(snapshot, { ...rc, storyDecision: undefined, render: undefined });
assert(!legacy.edges.some((e) => e.to === 'rc'));
assert(!legacy.nodes.some((n) => n.id === 'render'));
const mismatch = buildStoryLineage(snapshot, { ...rc, storyDecision: { ...rc.storyDecision!, versionId: 'C' } });
assert(!mismatch.edges.some((e) => e.to === 'rc'));
useEditorStore.getState().importProject(JSON.stringify(snapshot));
assert.deepEqual(buildStoryLineage(useEditorStore.getState().exportSnapshot()), buildStoryLineage(snapshot));
assert.deepEqual(buildStoryLineage(other, JSON.parse(JSON.stringify(rc)), evidence, new Date('2026-09-21T00:00:00.000Z')), graph);
const broken = buildStoryLineage(snapshot, rc, {
  candidates: [rc], observations: [{ ...obs1, source: { ...obs1.source, sourceFileSha256: undefined, mappingReceipt: undefined } }],
  experiments: [{ ...experiment, rightObservationId: 'missing-observation' }],
  learningRecords: [{ ...learning, provenance: { ...learning.provenance, rcIds: [rc.id], renderSha256: ['wrong'] } }],
}, new Date('2027-09-21T00:00:00.000Z'));
assert(broken.warnings.some((item) => item.includes('映射回执缺失')));
assert(broken.warnings.some((item) => item.includes('missing-observation')));
assert(broken.warnings.some((item) => item.includes('冲突')));
assert(broken.nodes.some((item) => item.id === 'observation:missing-observation' && item.kind === 'missing'));
const duplicateEvidence = buildStoryLineage(snapshot, rc, { ...evidence, observations: [obs1, obs1] });
assert(duplicateEvidence.warnings.some((item) => item.includes('发布观察 ID obs-1 重复')));
if (process.env.LINEAGE_CHECK_DIR) {
  writeFileSync(join(process.env.LINEAGE_CHECK_DIR, 'snapshot.json'), JSON.stringify(snapshot));
  writeFileSync(join(process.env.LINEAGE_CHECK_DIR, 'rc.json'), JSON.stringify(rc));
  writeFileSync(join(process.env.LINEAGE_CHECK_DIR, 'evidence.json'), JSON.stringify(evidence));
}
console.log('Story lineage checks passed: branching, release evidence, experiments, learning citations, RC isolation, missing/duplicate/conflicting records, immutability and persistence.');
