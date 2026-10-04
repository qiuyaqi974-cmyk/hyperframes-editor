import assert from 'node:assert/strict';
import { compareWithReleaseCandidate, createReleaseCandidate } from '../src/lib/releaseCandidate';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';

const plan: ScenePlan = {
  projectName: '候选版本测试',
  scenes: [
    { id: 'scene-1', duration: 4, blocks: [{ type: 'text', content: '真正的观点', duration: 4 }, { type: 'subtitle', content: '真正的观点', duration: 4 }] },
  ],
};
const snapshot = scenePlanToSnapshot(plan);
snapshot.director = {
  objective: '解释观点',
  audience: '创作者',
  thesis: '真正的观点',
  contentType: 'knowledge',
  tone: '克制',
  pacing: 'balanced',
  emotionArc: '疑问到理解',
  endingAction: '',
  visualRules: '',
  scenes: {
    'scene-1': { sceneId: 'scene-1', narrativeRole: 'hook', intent: '建立问题', visualRule: '', locked: true },
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const rc1 = createReleaseCandidate(snapshot, [], new Date('2026-01-02T00:00:00.000Z'));
assert.equal(rc1.label, 'RC-001');
assert.equal(rc1.health.blockers, 0);
assert.equal(compareWithReleaseCandidate(snapshot, rc1).changed, false);

const changed = structuredClone(snapshot);
changed.blocks[0].start = 0.5;
changed.blocks[0].duration = 3.5;
changed.director!.tone = '锋利';
changed.storyVersionSelection = { winnerVersionId: 'story-version-a', comparedVersionIds: ['story-version-a', 'story-version-b'], rationale: 'A 更紧凑', rejectedReasons: { 'story-version-b': '进入太慢' }, selectedAt: '2026-01-02T12:00:00.000Z' };
changed.assets.push({ id: 'asset-1', name: 'unused.png', kind: 'image', url: 'data:image/png;base64,AA==', width: 10, height: 10, size: 2 });
const diff = compareWithReleaseCandidate(changed, rc1);
assert.equal(diff.changed, true);
assert.equal(diff.blocks.changed, 1);
assert.equal(diff.assetsDelta, 1);
assert.equal(diff.directorChanged, true);
assert.equal(diff.storyDecisionChanged, true);
assert.equal(diff.healthDelta.warnings, 1);

// RC 是深拷贝的不可变基线，当前工程继续修改不会污染历史。
changed.blocks[0].name = '已修改';
assert.notEqual(rc1.snapshot.blocks[0].name, '已修改');

const rc2 = createReleaseCandidate(changed, [rc1], new Date('2026-01-03T00:00:00.000Z'));
assert.equal(rc2.label, 'RC-002');
assert.equal(rc2.version, 2);

console.log('Release candidate checks passed.');
