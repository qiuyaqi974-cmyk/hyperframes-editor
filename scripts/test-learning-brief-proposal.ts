import assert from 'node:assert/strict';
import { applyLearningBriefProposal, createLearningBriefProposal } from '../src/lib/learningBriefProposal';
import type { DirectorLearningView } from '../src/lib/directorLearningLibrary';
import { editorHistory, useEditorStore } from '../src/store/editorStore';

const director = structuredClone(useEditorStore.getState().director);
Object.assign(director, { audience: '旧受众', thesis: '旧表达', contentType: 'story', updatedAt: '2026-09-20T00:00:00.000Z' });
const view = (id: string, role: 'support' | 'counterexample' | 'context', freshness: 'fresh' | 'aging' | 'expired' = 'fresh', credentialStatus: 'verified' | 'unavailable' | 'mismatch' = 'verified'): DirectorLearningView => ({
  id, sourceKind: 'accepted-insight', category: 'retention', summary: `${role}-${id}`, evidence: ['描述性证据'], humanReason: '人工确认', capturedAt: '2026-09-19T00:00:00.000Z',
  scope: { platforms: ['B站'], accounts: ['账号A'], contentTypes: ['knowledge'], audiences: ['创作者'], projectNames: ['项目A'], topics: ['开场'] },
  provenance: { observationIds: [`obs-${id}`], rcIds: [`rc-${id}`], renderSha256: [`sha-${id}`], sourceConfirmedAt: freshness === 'expired' ? '2025-01-01T00:00:00.000Z' : '2026-09-19T00:00:00.000Z' },
  curation: { role, hypothesis: '核心内容应在前段出现', note: '仅适用于知识视频', curatedAt: '2026-09-19T01:00:00.000Z' },
  ageDays: freshness === 'fresh' ? 1 : freshness === 'aging' ? 100 : 600, freshness, credentialStatus,
});

const support = view('support', 'support');
const counterexample = view('counter', 'counterexample');
const context = view('context', 'context');
const all = [support, counterexample, context];

const missingCounterexample = createLearningBriefProposal(all, [support.id], director, new Date('2026-09-20T01:00:00.000Z'));
assert(missingCounterexample.blockers.some((item) => item.includes('未纳入的反例')));
const unavailable = createLearningBriefProposal([view('bad', 'support', 'fresh', 'unavailable')], ['bad'], director);
assert(unavailable.blockers.some((item) => item.includes('不可核验')));
const mismatch = createLearningBriefProposal([view('bad', 'support', 'fresh', 'mismatch')], ['bad'], director);
assert(mismatch.blockers.some((item) => item.includes('哈希发生冲突')));

const proposal = createLearningBriefProposal(all, [support.id, counterexample.id, context.id], director, new Date('2026-09-20T01:00:00.000Z'));
assert.deepEqual(proposal.blockers, []);
assert.equal(proposal.suggested.thesis, '核心内容应在前段出现');
assert.equal(proposal.suggested.audience, '创作者');
assert.equal(proposal.suggested.contentType, 'knowledge');
assert.equal(proposal.citations.length, 3);
assert.equal(proposal.citations[0].provenance.renderSha256[0], 'sha-support');
assert.throws(() => applyLearningBriefProposal(proposal, all, director, proposal.suggested, ['thesis'], { confirmedEvidence: false, acknowledgedExpired: false, rationale: '适用' }), /逐条检查/);
assert.throws(() => applyLearningBriefProposal(proposal, all, { ...director, updatedAt: 'changed' }, proposal.suggested, ['thesis'], { confirmedEvidence: true, acknowledgedExpired: false, rationale: '适用' }), /重新生成/);
const changedEvidence = all.map((item) => item.id === support.id ? { ...item, freshness: 'aging' as const } : item);
assert.throws(() => applyLearningBriefProposal(proposal, changedEvidence, director, proposal.suggested, ['thesis'], { confirmedEvidence: true, acknowledgedExpired: false, rationale: '适用' }), /引用证据已变化/);

const expiredSupport = view('expired-support', 'support', 'expired');
const expiredProposal = createLearningBriefProposal([expiredSupport], [expiredSupport.id], director, new Date('2026-09-20T01:00:00.000Z'));
assert(expiredProposal.requiresExpiredAcknowledgement);
assert.throws(() => applyLearningBriefProposal(expiredProposal, [expiredSupport], director, expiredProposal.suggested, ['thesis'], { confirmedEvidence: true, acknowledgedExpired: false, rationale: '范围相同' }), /过期记录/);

const patch = applyLearningBriefProposal(proposal, all, director, { ...proposal.suggested, audience: '编辑后的受众' }, ['thesis', 'audience'], { confirmedEvidence: true, acknowledgedExpired: false, rationale: '同平台、同类型，只采用可复核结论。' }, new Date('2026-09-20T02:00:00.000Z'));
assert.equal(patch.thesis, '核心内容应在前段出现');
assert.equal(patch.audience, '编辑后的受众');
assert.equal(patch.contentType, undefined, 'unconfirmed fields are untouched');
assert.equal(patch.learningApplications?.[0].citations[1].role, 'counterexample');

const empty = useEditorStore.getState().exportSnapshot();
useEditorStore.getState().importSnapshot({ ...empty, director });
editorHistory.reset();
useEditorStore.getState().updateDirector(patch);
await Promise.resolve();
assert.equal(useEditorStore.getState().director.learningApplications?.length, 1);
assert(editorHistory.undo(), 'application is one undoable document update');
assert.equal(useEditorStore.getState().director.thesis, '旧表达');
assert.equal(useEditorStore.getState().director.learningApplications?.length ?? 0, 0);
assert(editorHistory.redo());
assert.equal(useEditorStore.getState().director.thesis, '核心内容应在前段出现');
useEditorStore.getState().importSnapshot(empty);

console.log('Learning Brief proposal checks passed: scoped citations, counterexample and credential gates, freshness acknowledgement, selected fields, audit snapshot and undo/redo.');
