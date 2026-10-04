import assert from 'node:assert/strict';
import { createWinningStoryHandoff } from '../src/lib/sourceStoryHandoff';
import { importRefinedStoryEdl } from '../src/lib/sourceStoryRoundtrip';
import { createSourceStoryVersion, restoreSourceStoryVersion } from '../src/lib/sourceStoryVersions';
import type { DirectorDecision, ExternalMediaSource, ProjectSnapshot, SourceRoughCutCandidate } from '../src/types';

const director: DirectorDecision = { objective: '', audience: '', thesis: '', contentType: 'tutorial', tone: '', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '', scenes: {}, updatedAt: 'director-v1' };
function candidate(id: string, text: string, start: number): SourceRoughCutCandidate {
  return { id, text, start, end: start + 3, decision: 'keep', boundary: 'word', pauseBefore: null, pauseAfter: null, reason: '' };
}
const source: ExternalMediaSource = {
  id: 's1', name: 'cook.mp4', path: 'D:/media/cook.mp4', duration: 100, width: 1920, height: 1080, size: 100,
  status: 'original', createdAt: '', roughCutPlan: {
    version: 1, sourceId: 's1', generatedAt: '', strategy: { pauseThreshold: 0.45, paddingBefore: 0.05, paddingAfter: 0.08, pacing: 'balanced', objective: '', thesis: '', directorUpdatedAt: director.updatedAt },
    candidates: [candidate('a', '开场', 1), candidate('b', '过程', 10), candidate('c', '成品', 20)], assembly: { order: ['a', 'b', 'c'] },
  }, transcript: [
    { id: 'ta', start: 1.05, end: 3.8, text: '开场', words: [{ start: 1.05, end: 1.5, word: '开场' }] },
    { id: 'tb', start: 10.05, end: 12.8, text: '过程', words: [{ start: 10.05, end: 10.5, word: '过程' }] },
    { id: 'tc', start: 20.05, end: 22.8, text: '成品', words: [{ start: 20.05, end: 20.5, word: '成品' }] },
  ],
};
const assembly = { version: 1 as const, generatedAt: '', directorUpdatedAt: director.updatedAt, sourceSignatures: {}, items: [
  { sourceId: 's1', candidateId: 'a', narrativeRole: 'hook' as const }, { sourceId: 's1', candidateId: 'b', narrativeRole: 'argument' as const }, { sourceId: 's1', candidateId: 'c', narrativeRole: 'cta' as const },
] };
const base = createSourceStoryVersion(assembly, [source], [], '导演胜出', new Date('2026-09-19T00:00:00.000Z'));
const snapshot = {
  app: 'hyperframes-editor', version: 4, projectName: '回写测试', canvas: { width: 1920, height: 1080, fps: 30, background: '#000' }, assets: [], blocks: [], sourceMedia: [source],
  storyAssembly: { ...assembly, appliedAt: 'now', appliedBlockIds: ['a', 'b', 'c'] }, storyAssemblyVersions: [base],
  storyVersionSelection: { winnerVersionId: base.id, comparedVersionIds: [base.id, base.id] as [string, string], rationale: '清楚', rejectedReasons: {}, selectedAt: '' },
  narration: null, scenes: [], reviews: {}, director, updatedAt: '',
} satisfies ProjectSnapshot;
const exported = createWinningStoryHandoff(snapshot).edl;
const refined = {
  ...exported,
  ranges: [
    { ...exported.ranges[2], start: 19.9, end: 23.1 },
    { ...exported.ranges[0] },
  ],
};
const result = importRefinedStoryEdl(refined, base, [source], [base], 'edl-refined.json', new Date('2026-09-19T01:00:00.000Z'));
assert.equal(result.version.label, '方案 B');
assert.equal(result.version.provenance?.parentVersionId, base.id);
assert.equal(result.version.segments.length, 2);
assert.equal(result.version.segments[0].candidateId, 'c');
assert.equal(result.diff.removed, 1);
assert(result.diff.moved >= 1);
assert.equal(result.diff.boundaryChanged, 1);
assert.equal(base.segments[2].start, 20, '导回不得修改原胜出方案');

const restored = restoreSourceStoryVersion(result.version, [source], director);
assert.equal(restored.sources[0].roughCutPlan?.candidates.find((item) => item.id === 'c')?.start, 19.9);
assert.equal(restored.assembly.confirmedAt, undefined);
assert.throws(() => importRefinedStoryEdl(exported, base, [source], [base], 'same.json'), /完全相同/);
assert.throws(() => importRefinedStoryEdl({ ...refined, metadata: { originVersionId: 'wrong' } }, base, [source], [base], 'wrong.json'), /不是从当前胜出方案/);
assert.throws(() => importRefinedStoryEdl({ ...refined, ranges: [{ ...refined.ranges[0], candidateId: 'unknown', label: '新增镜头' }] }, base, [source], [base], 'added.json'), /外部新增片段/);
assert.throws(() => importRefinedStoryEdl({ ...refined, ranges: [{ ...refined.ranges[0], start: 20.2 }] }, base, [source], [base], 'inside-word.json'), /词语内部/);

console.log('Source story roundtrip checks passed.');
