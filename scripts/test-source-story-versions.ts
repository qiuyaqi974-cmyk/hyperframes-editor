import assert from 'node:assert/strict';
import { applySourceStoryTemplate, createSourceStoryAssembly, moveSourceStoryItem, reviseSourceStoryBoundary, sourceStoryAssemblyReadiness } from '../src/lib/sourceStoryAssembly';
import { compareSourceStoryVersions, createSourceStoryVersion, restoreSourceStoryVersion } from '../src/lib/sourceStoryVersions';
import { analyzeProjectHealth } from '../src/lib/projectHealth';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import type { DirectorDecision, ExternalMediaSource, ProjectSnapshot, SourceRoughCutCandidate } from '../src/types';

const director: DirectorDecision = {
  objective: '比较两种教程结构', audience: '新手', thesis: '步骤要清楚', contentType: 'tutorial', tone: '自然', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '', scenes: {}, updatedAt: 'director-v1',
};

function candidate(id: string, text: string, start: number): SourceRoughCutCandidate {
  return { id, text, start, end: start + 2, decision: 'keep', boundary: 'word', pauseBefore: null, pauseAfter: null, reason: '测试', visualReview: { status: 'approved', checkedAt: '', windowStart: start, windowEnd: start + 2 } };
}

function source(id: string, candidates: SourceRoughCutCandidate[]): ExternalMediaSource {
  return {
    id, name: `${id}.mp4`, path: `D:/${id}.mp4`, duration: 30, width: 1920, height: 1080, size: 1, status: 'original', createdAt: '',
    transcript: candidates.map((item) => ({ id: `t-${item.id}`, start: item.start + 0.05, end: item.end - 0.08, text: item.text, words: [{ start: item.start + 0.05, end: item.end - 0.08, word: item.text }] })),
    roughCutPlan: { version: 1, sourceId: id, generatedAt: `${id}-plan`, strategy: { pauseThreshold: 0.45, paddingBefore: 0.05, paddingAfter: 0.08, pacing: 'balanced', objective: '', thesis: '', directorUpdatedAt: director.updatedAt }, candidates, assembly: { order: candidates.map((item) => item.id) } },
  };
}

const sources = [source('camera-a', [candidate('a1', '准备材料', 1), candidate('a2', '开始下锅', 5)]), source('camera-b', [candidate('b1', '展示成品', 3)])];
let assembly = applySourceStoryTemplate(createSourceStoryAssembly(sources, director), 'tutorial');
const versionA = createSourceStoryVersion(assembly, sources, [], '顺叙版本', new Date('2026-09-19T00:00:00.000Z'));
assert.equal(versionA.label, '方案 A');
assert.equal(versionA.note, '顺叙版本');

assembly = moveSourceStoryItem(assembly, 2, -1);
const revised = reviseSourceStoryBoundary(assembly, sources, director, 0, 'end', 0.05);
const versionB = createSourceStoryVersion(revised.assembly, revised.sources, [versionA], '先看结果', new Date('2026-09-19T00:01:00.000Z'));
assert.equal(versionB.label, '方案 B');
const diff = compareSourceStoryVersions(versionA, versionB);
assert(diff.moved >= 2);
assert.equal(diff.boundaryChanged, 1);
assert(Math.abs(diff.durationDelta - 0.05) < 0.001);

assert.throws(() => createSourceStoryVersion(versionB.assembly, revised.sources, [versionA, versionB]), /已经保存过/);
const restored = restoreSourceStoryVersion(versionA, revised.sources, director, new Date('2026-09-19T00:02:00.000Z'));
assert.equal(restored.assembly.items[1].candidateId, 'a2');
assert.equal(restored.sources[0].roughCutPlan?.candidates[0].end, 3);
assert.equal(restored.sources[0].roughCutPlan?.candidates[0].decision, 'keep', '恢复方案不得改变源候选保留结论');
assert.equal(restored.assembly.confirmedAt, undefined);
assert.equal(restored.assembly.preview, undefined);
assert.equal(sourceStoryAssemblyReadiness(restored.assembly, restored.sources, director.updatedAt).signaturesStale, false);

const missing = revised.sources.map((item) => item.id === 'camera-a' ? { ...item, roughCutPlan: { ...item.roughCutPlan!, candidates: item.roughCutPlan!.candidates.map((entry) => entry.id === 'a2' ? { ...entry, decision: 'drop' as const } : entry) } } : item);
assert.throws(() => restoreSourceStoryVersion(versionA, missing, director), /不再保留/);

const readyState = sourceStoryAssemblyReadiness(revised.assembly, revised.sources, director.updatedAt);
const reviewedPreview = { path: 'D:/preview-b.mp4', duration: readyState.duration, generatedAt: '', structureFingerprint: readyState.structureFingerprint, boundaries: [{ outputTime: 2.05, beforeIndex: 0, afterIndex: 1, status: 'approved' as const }, { outputTime: 4.05, beforeIndex: 1, afterIndex: 2, status: 'approved' as const }], reviewedAt: '2026-09-19T00:03:00.000Z' };
const reviewedA = { ...versionA, assembly: { ...versionA.assembly, preview: { ...reviewedPreview, path: 'D:/preview-a.mp4' } } };
const reviewedB = { ...versionB, assembly: { ...versionB.assembly, preview: reviewedPreview } };
const appliedAssembly = { ...revised.assembly, confirmedAt: '2026-09-19T00:03:00.000Z', preview: reviewedPreview, appliedAt: '2026-09-19T00:04:00.000Z', appliedBlockIds: ['story-block'] };
const snapshot: ProjectSnapshot = {
  app: 'hyperframes-editor', version: 4, projectName: '选版测试', themeId: 'midnight', canvas: { width: 1920, height: 1080, fps: 30, background: '#000' }, assets: [], sourceMedia: revised.sources,
  storyAssembly: appliedAssembly, storyAssemblyVersions: [reviewedA, reviewedB],
  storyVersionSelection: { winnerVersionId: reviewedB.id, comparedVersionIds: [reviewedA.id, reviewedB.id], rationale: '步骤更紧凑', rejectedReasons: { [reviewedA.id]: '开场进入太慢' }, selectedAt: '2026-09-19T00:03:30.000Z' },
  narration: null, scenes: [], reviews: {}, director, updatedAt: '',
  blocks: [{ id: 'story-block', type: 'text', name: '步骤要清楚', props: { text: '步骤要清楚', fontSize: 48, color: '#fff', fontWeight: 700, letterSpacing: 0, lineHeight: 1.2, opacity: 1, align: 'left', maxWidth: 900 }, animation: { type: 'none', duration: 0, delay: 0, easing: 'linear', direction: 'up', distance: 0, from: 1 }, position: { x: 0, y: 0 }, start: 0, duration: 2, layer: 0, visible: true, locked: false }],
};
assert.equal(analyzeProjectHealth(snapshot).blockers.some((issue) => issue.id.startsWith('story-winner-')), false);
const rc = createReleaseCandidate(snapshot, [], new Date('2026-09-19T00:05:00.000Z'));
assert.equal(rc.storyDecision?.versionId, reviewedB.id);
assert.equal(rc.storyDecision?.label, '方案 B');
assert(analyzeProjectHealth({ ...snapshot, storyVersionSelection: undefined }).blockers.some((issue) => issue.id === 'story-winner-missing'));
assert(analyzeProjectHealth({ ...snapshot, storyVersionSelection: { ...snapshot.storyVersionSelection!, winnerVersionId: reviewedA.id } }).blockers.some((issue) => issue.id === 'story-winner-not-current'));
assert(analyzeProjectHealth({ ...snapshot, storyAssembly: { ...appliedAssembly, appliedAt: undefined, appliedBlockIds: undefined } }).blockers.some((issue) => issue.id === 'story-winner-not-applied'));

console.log('Source story version checks passed.');
