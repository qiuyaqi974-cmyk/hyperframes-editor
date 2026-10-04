import assert from 'node:assert/strict';
import { generateBatchVoiceover } from '../src/lib/pipeline/batchVoiceover';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import type { TTSConfig, TTSProvider } from '../src/lib/tts';
import { useEditorStore } from '../src/store/editorStore';

const plan: ScenePlan = {
  projectName: '批量配音测试',
  scenes: [
    { id: 's1', duration: 5, blocks: [{ type: 'voice', content: '第一场', duration: 5 }, { type: 'subtitle', content: '第一场', duration: 5 }] },
    { id: 's2', duration: 4, blocks: [{ type: 'voice', content: '锁定场景', duration: 4 }, { type: 'subtitle', content: '锁定场景', duration: 4 }] },
    { id: 's3', duration: 6, blocks: [{ type: 'voice', content: '第三场', duration: 6 }, { type: 'subtitle', content: '第三场', duration: 6 }] },
  ],
};
const snapshot = scenePlanToSnapshot(plan);
snapshot.director = {
  objective: '', audience: '', thesis: '', contentType: 'knowledge', tone: '', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '', updatedAt: '',
  scenes: { s2: { sceneId: 's2', narrativeRole: 'proof', intent: '', visualRule: '', locked: true } },
};

const calls: Array<{ text: string; config: TTSConfig }> = [];
const provider: TTSProvider = {
  async synthesize(text, config) {
    calls.push({ text, config });
    return { src: `data:audio/mpeg;base64,${text}`, duration: text === '第一场' ? 2 : 3 };
  },
};

const result = await generateBatchVoiceover(snapshot, { provider });
assert.equal(calls.length, 2, '锁定场景不得调用 TTS');
assert.equal(calls[0].config.voiceName, 'x4_lingyuyan');
assert.equal(calls[0].config.speed, 68);
assert.equal(calls[0].config.volume, 56);
assert.equal(calls[0].config.pitch, 48);
assert.deepEqual(result.snapshot.scenes.map((scene) => [scene.start, scene.end]), [[0, 2], [5, 9], [9, 12]]);
assert.equal(result.skippedLocked, 1);
assert.equal(result.generated, 2);
assert.equal(result.snapshot.blocks.find((block) => block.type === 'voice' && block.sceneId === 's2')?.props.generated, false);

calls.length = 0;
const cached = await generateBatchVoiceover(result.snapshot, { provider });
assert.equal(calls.length, 0, '相同文案与参数应复用已有音频');
assert.equal(cached.reused, 2);

let failedOnce = false;
const flakyProvider: TTSProvider = {
  async synthesize(text) {
    if (text === '第三场' && !failedOnce) {
      failedOnce = true;
      throw new Error('模拟网络失败');
    }
    return { src: `data:audio/mpeg;base64,retry-${text}`, duration: text === '第一场' ? 2 : 3 };
  },
};
const partial = await generateBatchVoiceover(snapshot, { provider: flakyProvider });
assert.equal(partial.failures.length, 1);
assert.equal(partial.failures[0].blockName, 'AI配音');
const retry = await generateBatchVoiceover(partial.snapshot, {
  provider: flakyProvider,
  onlyBlockIds: partial.failures.map((failure) => failure.blockId),
});
assert.equal(retry.failures.length, 0);
assert.equal(retry.generated, 1);

useEditorStore.getState().importSnapshot(snapshot);
const previous = useEditorStore.getState().exportSnapshot();
useEditorStore.getState().applyVoiceTimeline(result.snapshot, previous);
assert.equal(useEditorStore.getState().scenes[0].duration, 2);
assert.equal(useEditorStore.getState().undoVoiceTimeline(), true);
assert.equal(useEditorStore.getState().scenes[0].duration, 5);
assert.equal(useEditorStore.getState().undoVoiceTimeline(), false);
console.log('batch voiceover test passed');
