import assert from 'node:assert/strict';
import { createReleaseRenderRequest } from '../src/lib/releaseRender';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';

const plan: ScenePlan = {
  projectName: '可复现渲染',
  canvas: { width: 1280, height: 720, fps: 25, background: '#000000' },
  scenes: [{ id: 'scene-1', duration: 3, blocks: [{ type: 'text', content: '最终画面', duration: 3 }] }],
};
const snapshot = scenePlanToSnapshot(plan);
snapshot.director = {
  objective: '完成交付', audience: '创作者', thesis: '最终画面', contentType: 'knowledge',
  tone: '克制', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '', scenes: {},
  updatedAt: '2026-02-01T00:00:00.000Z',
};
snapshot.reviews = {
  'scene-1': {
    sceneId: 'scene-1', status: 'approved', updatedAt: '2026-02-01T00:00:00.000Z',
    comments: [{ id: 'comment-1', time: 1, text: '已确认', resolved: true, createdAt: '2026-02-01T00:00:00.000Z' }],
  },
};
const candidate = createReleaseCandidate(snapshot, [], new Date('2026-02-02T00:00:00.000Z'));
const request = createReleaseRenderRequest(candidate, '<script>window.__HF_MOUNT_PLAYER=()=>{}</script>');

assert.equal(request.candidateLabel, 'RC-001');
assert.equal(request.width, 1280);
assert.equal(request.height, 720);
assert.equal(request.fps, 25);
assert.equal(request.duration, 6);
assert.equal(request.health.blockers, 0);
assert.equal(request.directorUpdatedAt, '2026-02-01T00:00:00.000Z');
assert.deepEqual(request.reviewSummary, { approved: 1, pending: 0, changes: 0, redo: 0, unresolvedComments: 0 });

console.log('Release render request checks passed.');
