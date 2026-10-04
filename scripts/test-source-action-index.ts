import assert from 'node:assert/strict';
import { actionEntryIsCurrent, actionSourceSignature, createActionEntry, searchActionIndex } from '../src/lib/sourceActionIndex';
import { createSourceRoughCutPlan } from '../src/lib/roughCutPlan';
import { editorHistory, useEditorStore } from '../src/store/editorStore';
import type { ExternalMediaSource } from '../src/types';

const source: ExternalMediaSource = { id: 'a', name: '厨房原片', path: 'D:/kitchen.mp4', duration: 3600, size: 999, width: 1920, height: 1080, status: 'original', createdAt: '' };
const draft = { subject: '厨师', action: '翻炒', object: '青菜', result: '变软', tags: '烹饪,起锅，烹饪', shot: 'detail' as const, kind: 'highlight' as const };
const range = { start: 100.125, end: 107.875 };
assert.throws(() => createActionEntry(source, range, draft, false), /观看/);
assert.throws(() => createActionEntry(source, range, { ...draft, action: ' ' }, true), /动作/);
for (const bad of [{ start: -1, end: 3 }, { start: 4, end: 2 }, { start: NaN, end: 3 }, { start: 0, end: Infinity }, { start: 3599, end: 3601 }]) {
  assert.throws(() => createActionEntry(source, bad, draft, true), /范围/);
}
assert.throws(() => createActionEntry({ ...source, status: 'missing' }, range, draft, true), /离线/);
const entry = createActionEntry(source, range, draft, true);
assert.deepEqual(entry.semantics!.tags, ['烹饪', '起锅']);
const evidence = {
  source: 'model-assisted' as const, mode: 'cross-frame' as const, providerId: 'local-openai', provider: '本机模型', model: 'vision-test', analysisPass: 'refinement' as const,
  transcriptIncluded: false,
  requestPayload: {
    requestId: 'visual-request-test', requestedAt: '2026-10-04T00:00:00.000Z',
    imageCount: 2, imageBytes: 18, transcriptCharacters: 0, spanSeconds: 6.5, sessionRequestNumber: 2,
    tokenUsage: { inputTokens: 120, outputTokens: 20, totalTokens: 140 },
    frames: [{ id: 'a', time: 101, sha256: 'a'.repeat(64) }, { id: 'b', time: 106, sha256: 'b'.repeat(64) }],
  },
  frames: [{ id: 'a', time: 101, windowStart: 100.5, windowEnd: 101.5 }, { id: 'b', time: 106, windowStart: 105.5, windowEnd: 107 }],
  proposal: { subject: '厨师', action: '搅动', object: '青菜', result: '颜色变化', shot: 'detail' as const, tags: ['模型候选'] },
  continuity: 'state-change' as const, visibleEvidence: '前后颜色不同', uncertainty: '中间过程未连续观察', confidence: 0.66,
  changeWindows: [{ beforeFrameId: 'a', afterFrameId: 'b', start: 101, end: 106, assessment: 'visible-change' as const, evidence: '颜色不同', uncertainty: '具体时刻未知', confidence: 0.64 }],
  refinementComparison: {
    status: 'changed' as const, changedFields: ['action'] as Array<'action'>,
    initial: { frameIds: ['a', 'b'], action: '搅动', result: '颜色变化', continuity: 'state-change' as const, changeWindowAssessments: ['visible-change' as const], confidence: 0.61 },
    refined: { frameIds: ['a', 'b'], action: '翻炒', result: '颜色变化', continuity: 'state-change' as const, changeWindowAssessments: ['visible-change' as const], confidence: 0.66 },
  },
  refinementReview: { acknowledged: true as const, resolution: 'human-confirmed-final-fields' as const, reviewedAt: '2026-10-04T00:00:00.000Z' },
};
const assisted = createActionEntry(source, range, draft, true, evidence);
assert.equal(assisted.semantics?.visualEvidence?.analysisPass, 'refinement');
assert.equal(assisted.semantics?.visualEvidence?.transcriptIncluded, false);
assert.equal(assisted.semantics?.visualEvidence?.requestPayload?.sessionRequestNumber, 2);
assert.equal(assisted.semantics?.visualEvidence?.requestPayload?.requestId, 'visual-request-test');
assert.equal(assisted.semantics?.visualEvidence?.requestPayload?.tokenUsage?.totalTokens, 140);
assert.equal(assisted.semantics?.visualEvidence?.proposal.action, '搅动', '回执应保留模型原候选，而不是覆盖人工确认字段');
assert.equal(assisted.semantics?.visualEvidence?.changeWindows?.[0].start, 101);
assert.equal(assisted.semantics?.visualEvidence?.refinementComparison?.status, 'changed');
assert.equal(assisted.semantics?.action, '翻炒');
assert.throws(() => createActionEntry(source, range, draft, true, {
  ...evidence,
  frames: [{ ...evidence.frames[0], time: 99 }],
  requestPayload: { ...evidence.requestPayload, imageCount: 1, frames: [{ id: 'a', time: 99, sha256: 'a'.repeat(64) }] },
}), /截图范围/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, changeWindows: [{ ...evidence.changeWindows[0], end: 108 }] }), /变化区间/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, refinementComparison: { ...evidence.refinementComparison, status: 'consistent' } }), /补帧对照/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, refinementReview: undefined }), /核对补帧前后/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, refinementComparison: undefined }), /缺少两轮对照/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, transcriptIncluded: 'yes' as unknown as boolean }), /口播输入标记/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, requestPayload: { ...evidence.requestPayload, imageCount: 1 } }), /图片数少于/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, requestPayload: { ...evidence.requestPayload, transcriptCharacters: 1 } }), /仅截图回执/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, requestPayload: { ...evidence.requestPayload, requestId: '' } }), /负载回执/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, requestPayload: { ...evidence.requestPayload, requestedAt: 'not-a-date' } }), /负载回执/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, requestPayload: { ...evidence.requestPayload, frames: [evidence.requestPayload.frames[0]] } }), /截图清单/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, requestPayload: { ...evidence.requestPayload, frames: [{ ...evidence.requestPayload.frames[0], sha256: 'bad' }, evidence.requestPayload.frames[1]] } }), /内容指纹/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, requestPayload: { ...evidence.requestPayload, tokenUsage: { inputTokens: 120, outputTokens: 20, totalTokens: 999 } } }), /token 用量/);
assert.throws(() => createActionEntry(source, range, draft, true, { ...evidence, frames: [{ ...evidence.frames[0], id: 'outside-request' }] }), /不属于视觉请求批次/);
const indexed = { ...source, eventMarkers: [entry] };
const other = { ...source, id: 'b', name: '花园原片', path: 'D:/garden.mp4', eventMarkers: [{ ...entry, id: 'legacy', label: '浇花', semantics: undefined }] };
assert.equal(searchActionIndex([indexed, other], '厨师 青菜', 'detail', 'highlight').length, 1);
assert.equal(searchActionIndex([indexed, other], '起锅')[0].marker.id, entry.id);
assert.equal(searchActionIndex([indexed, other], '浇花')[0].source.id, 'b');
assert.equal(searchActionIndex([indexed], '不存在').length, 0);
assert.equal(searchActionIndex([indexed], '', 'wide').length, 0);
assert(actionEntryIsCurrent({ ...indexed, proxyPath: 'D:/proxy.mp4' }, entry), 'proxy does not change original identity');
for (const changed of [{ ...indexed, path: 'D:/wrong.mp4' }, { ...indexed, size: 5 }, { ...indexed, duration: 2000 }]) {
  assert(!searchActionIndex([changed], '')[0].current);
}
assert(!actionEntryIsCurrent(indexed, { ...entry, end: 108 }));

const state = useEditorStore.getState();
const initial = state.exportSnapshot();
const plan = createSourceRoughCutPlan(source.id, source.duration, [], initial.director!, { markers: [entry], markerSourceSignature: actionSourceSignature(source) });
assert.equal(createSourceRoughCutPlan(source.id, source.duration, [], initial.director!, { markers: [entry], markerSourceSignature: 'wrong' }).candidates.length, 0);
assert.equal(plan.candidates[0].markerId, entry.id);
assert.equal(plan.candidates[0].visualReview, undefined, 'semantic observation cannot approve editorial cut');
assert.throws(() => createActionEntry({ ...indexed, roughCutPlan: { ...plan, appliedBlockIds: ['block'] } }, range, draft, true), /撤销/);
state.importSnapshot({ ...initial, sourceMedia: [source] });
useEditorStore.getState().updateSourceMedia(source.id, { eventMarkers: [entry] });
await Promise.resolve();
const saved = JSON.parse(JSON.stringify(useEditorStore.getState().exportSnapshot()));
assert.equal(saved.sourceMedia[0].eventMarkers[0].semantics.sourceSignature, entry.semantics!.sourceSignature);
assert(editorHistory.undo());
assert.equal(searchActionIndex(useEditorStore.getState().sourceMedia, '').length, 0);
assert(editorHistory.redo());
assert.equal(searchActionIndex(useEditorStore.getState().sourceMedia, '变软').length, 1);
useEditorStore.getState().importSnapshot(saved);
assert.equal(searchActionIndex(useEditorStore.getState().sourceMedia, '翻炒')[0].marker.start, range.start);
assert.equal(useEditorStore.getState().blocks.length, initial.blocks.length, 'index does not append timeline');
assert.equal(useEditorStore.getState().storyAssemblyVersions.length, initial.storyAssemblyVersions?.length ?? 0);
console.log('Action index checks passed: source/range validation, human gate, search, provenance, persistence, undo/redo and cut review separation.');
