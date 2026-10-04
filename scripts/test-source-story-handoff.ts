import assert from 'node:assert/strict';
import { createWinningStoryHandoff } from '../src/lib/sourceStoryHandoff';
import { createSourceStoryVersion } from '../src/lib/sourceStoryVersions';
import type { ExternalMediaSource, ProjectSnapshot } from '../src/types';

const source: ExternalMediaSource = {
  id: 'camera-a', name: 'cooking.mp4', path: 'D:/footage/cooking.mp4', duration: 120, width: 1920, height: 1080, size: 99,
  status: 'original', createdAt: '', roughCutPlan: {
    version: 1, sourceId: 'camera-a', generatedAt: '', strategy: { pauseThreshold: 0.45, paddingBefore: 0.05, paddingAfter: 0.08, pacing: 'balanced', objective: '', thesis: '', directorUpdatedAt: 'director-v1' },
    candidates: [
      { id: 'clip-a', text: '先把锅烧热', start: 10, end: 14.25, decision: 'keep', boundary: 'word', pauseBefore: null, pauseAfter: null, reason: '' },
      { id: 'clip-b', text: '现在出锅', start: 70, end: 73.5, decision: 'keep', boundary: 'word', pauseBefore: null, pauseAfter: null, reason: '' },
    ], assembly: { order: ['clip-a', 'clip-b'] },
  },
};
const assembly = {
  version: 1 as const, generatedAt: '', directorUpdatedAt: 'director-v1', sourceSignatures: {},
  items: [{ sourceId: source.id, candidateId: 'clip-a', narrativeRole: 'hook' as const }, { sourceId: source.id, candidateId: 'clip-b', narrativeRole: 'cta' as const }],
};
const winner = createSourceStoryVersion(assembly, [source], [], '最快进入主题', new Date('2026-09-19T01:00:00.000Z'));
const snapshot = {
  app: 'hyperframes-editor', version: 4, projectName: '做饭教程', themeId: 'midnight', canvas: { width: 1920, height: 1080, fps: 30, background: '#000' },
  assets: [], sourceMedia: [source], storyAssembly: { ...assembly, appliedAt: '2026-09-19T01:01:00.000Z', appliedBlockIds: ['clip-a', 'clip-b'] },
  storyAssemblyVersions: [winner], storyVersionSelection: { winnerVersionId: winner.id, comparedVersionIds: [winner.id, winner.id] as [string, string], rationale: '最清楚', rejectedReasons: {}, selectedAt: '2026-09-19T01:00:30.000Z' },
  narration: null, scenes: [], reviews: {}, director: { objective: '', audience: '', thesis: '', contentType: 'tutorial', tone: '', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '', scenes: {}, updatedAt: 'director-v1' }, blocks: [], updatedAt: '',
} satisfies ProjectSnapshot;

const payload = createWinningStoryHandoff(snapshot, new Date('2026-09-19T02:00:00.000Z'));
assert.equal(payload.ranges.length, 2);
assert.equal(payload.ranges[1].outputStart, 4.25);
assert.equal(payload.totalDuration, 7.75);
assert.equal(payload.edl.sources.S001, source.path);
assert.equal(payload.edl.ranges[0].beat, 'hook');
assert.equal(payload.edl.ranges[0].candidateId, 'clip-a');
assert.equal(payload.edl.metadata.originVersionId, winner.id);
assert.match(payload.subtitlesSrt, /00:00:04,250 --> 00:00:07,750/);
assert.match(payload.clipListCsv, /现在出锅/);
assert.match(payload.readme, /不伪装成剪映私有草稿/);
assert.throws(() => createWinningStoryHandoff({ ...snapshot, storyVersionSelection: undefined }), /还没有选出/);
assert.throws(() => createWinningStoryHandoff({ ...snapshot, storyAssembly: { ...assembly } }), /没有装配/);
assert.throws(() => createWinningStoryHandoff({ ...snapshot, storyAssembly: { ...snapshot.storyAssembly!, items: [...assembly.items].reverse() } }), /不是胜出方案/);

console.log('Source story handoff checks passed.');
