import assert from 'node:assert/strict';
import { scenePlanToSnapshot } from '../src/lib/agent/scenePlan';
import { createDeliveryPackage } from '../src/lib/exportDeliveryPackage';
import { analyzeProjectHealth } from '../src/lib/projectHealth';
import { createReleaseCandidate, compareWithReleaseCandidate } from '../src/lib/releaseCandidate';
import { useEditorStore } from '../src/store/editorStore';

const snapshot = scenePlanToSnapshot({
  projectName: '审片测试',
  scenes: [{ id: 'scene-1', duration: 4, blocks: [{ type: 'text', content: '第一幕', duration: 4 }] }],
});
useEditorStore.getState().importSnapshot(snapshot);

useEditorStore.getState().setSceneReviewStatus('scene-1', 'approved');
let state = useEditorStore.getState();
assert.equal(state.reviews['scene-1'].status, 'approved');
assert.equal(state.director.scenes['scene-1'].locked, true, '通过必须锁定场景');

const commentId = state.addSceneReviewComment('scene-1', 2.25, '这里的证据画面需要更具体');
state = useEditorStore.getState();
assert.equal(state.reviews['scene-1'].status, 'changes', '通过后新增批注必须重新打开场景');
assert.equal(state.director.scenes['scene-1'].locked, false);
assert.equal(analyzeProjectHealth(state.exportSnapshot()).blockers.some((issue) => issue.id === 'review-changes-scene-1'), true);

state.resolveSceneReviewComment('scene-1', commentId, true);
state.setSceneReviewStatus('scene-1', 'approved');
state = useEditorStore.getState();
assert.equal(analyzeProjectHealth(state.exportSnapshot()).blockers.length, 0);

const rc = createReleaseCandidate(state.exportSnapshot(), [], new Date('2026-09-19T00:00:00.000Z'));
state.setSceneReviewStatus('scene-1', 'pending');
assert.equal(compareWithReleaseCandidate(useEditorStore.getState().exportSnapshot(), rc).reviewChanged, true);

const delivery = createDeliveryPackage(rc.snapshot);
assert.equal(delivery.sceneplan.reviews?.['scene-1'].comments[0].time, 2.25);
assert.equal(delivery.manifest.reviews?.['scene-1'].status, 'approved');

console.log('Scene review checks passed.');
