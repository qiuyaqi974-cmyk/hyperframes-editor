import assert from 'node:assert/strict';
import { generateProjectSnapshot } from '../src/lib/agent/projectGenerator';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { useEditorStore } from '../src/store/editorStore';

const quickProject = generateProjectSnapshot({ topic: '测试主题', script: '第一句。第二句。' });
assert.equal(quickProject.scenes.length, 1);
assert.ok(quickProject.blocks.every((block) => block.sceneId === quickProject.scenes[0].id));

const scenePlan: ScenePlan = {
  projectName: '场景归属测试',
  scenes: [
    { id: 'hook', duration: 3, blocks: [{ type: 'text', content: '钩子', duration: 3 }] },
    { id: 'proof', duration: 4, blocks: [{ type: 'card', content: '证据', duration: 4 }] },
  ],
};
const plannedProject = scenePlanToSnapshot(scenePlan);
assert.deepEqual(plannedProject.blocks.map((block) => block.sceneId), ['hook', 'proof']);
assert.deepEqual(plannedProject.blocks.map((block) => block.start), [0, 3]);

useEditorStore.getState().importSnapshot(quickProject);
useEditorStore.getState().updateDirector({ objective: '建立信任', audience: '刚开始使用 AI 的创作者', thesis: '先建立流程，再追求工具数量' });
useEditorStore.getState().updateSceneDecision('scene-1', { locked: true, narrativeRole: 'hook' });
const directedSnapshot = useEditorStore.getState().exportSnapshot();
assert.equal(directedSnapshot.director?.thesis, '先建立流程，再追求工具数量');
assert.equal(directedSnapshot.director?.scenes['scene-1']?.locked, true);
assert.throws(
  () => useEditorStore.getState().importGeneratedSnapshot(plannedProject),
  /导演锁定场景/,
);
useEditorStore.getState().updateSceneDecision('scene-1', { locked: false });
useEditorStore.getState().importGeneratedSnapshot(plannedProject);
assert.equal(useEditorStore.getState().director.thesis, '先建立流程，再追求工具数量');
console.log('production workflow test passed');
