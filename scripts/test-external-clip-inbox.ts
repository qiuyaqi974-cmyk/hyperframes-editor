import assert from 'node:assert/strict';
import { inspectExternalClips, finalizeExternalClips } from '../src/lib/externalClipInbox';
import { createSourceStoryVersion, restoreSourceStoryVersion } from '../src/lib/sourceStoryVersions';
import { resolveSourceStoryAssembly, sourceStoryAssemblyReadiness } from '../src/lib/sourceStoryAssembly';
import { useEditorStore } from '../src/store/editorStore';
import type { ExternalMediaSource, SourceStoryAssembly } from '../src/types';

const director = useEditorStore.getState().director;
const source: ExternalMediaSource = { id: 's', name: 'source.mp4', path: 'D:/source.mp4', duration: 60, width: 1280, height: 720, size: 100, status: 'original', createdAt: '', roughCutPlan: { version: 1, sourceId: 's', generatedAt: '', strategy: { pauseThreshold: 0.45, paddingBefore: 0, paddingAfter: 0, pacing: 'balanced', objective: '', thesis: '' }, candidates: [{ id: 'original', start: 0, end: 3, text: '开场', boundary: 'manual', decision: 'keep', reason: '', pauseBefore: null, pauseAfter: null }] } };
const assembly: SourceStoryAssembly = { version: 1, generatedAt: '', directorUpdatedAt: director.updatedAt, sourceSignatures: {}, items: [{ sourceId: 's', candidateId: 'original', narrativeRole: 'hook' }] };
const base = createSourceStoryVersion(assembly, [source], []);
const input = { version: 1, metadata: { originVersionId: base.id }, sources: { camera: source.path }, ranges: [{ source: 'camera', sourceId: 's', candidateId: 'original', start: 0, end: 3 }, { source: 'camera', sourceId: 's', start: 10, end: 15, label: '001 新镜头', quote: '新的证据' }] };
const before = JSON.stringify({ source, base, assembly });
const inbox = inspectExternalClips(input, base, [source], 'refined.json');
assert.equal(inbox.clips.length, 1, 'ordinal labels must not silently map new clips');
assert.equal(inbox.clips[0].boundaryStatus, 'manual');
assert.throws(() => finalizeExternalClips(inbox, base, [source], [base]), /最终决定/);
inbox.clips[0].decision = 'approve';
assert.throws(() => finalizeExternalClips(inbox, base, [source], [base]), /来源、边界、视觉/);
Object.assign(inbox.clips[0], { mappingStatus: 'confirmed', boundaryConfirmed: true, visualStatus: 'approved', narrativeRole: 'proof' });
const approved = finalizeExternalClips(inbox, base, [source], [base]);
assert.equal(approved.diff.added, 1);
assert.equal(approved.version.segments.length, 2);
assert.equal(approved.version.externalCandidates?.[0].candidate.id, inbox.clips[0].id);
assert.equal(approved.version.assembly.preview, undefined);
assert.equal(JSON.stringify({ source, base, assembly }), before, 'saving must not mutate source, parent or timeline');

const rejected = structuredClone(inbox);
rejected.clips[0].decision = 'reject';
assert.throws(() => finalizeExternalClips(rejected, base, [source], [base]), /拒绝理由/);
rejected.clips[0].reason = '与叙事无关';
const rejectedResult = finalizeExternalClips(rejected, base, [source], [base]);
assert.equal(rejectedResult.version.segments.length, 1);
assert.equal(rejectedResult.version.externalCandidates?.length, 0);
assert.equal(rejected.clips[0].reason, '与叙事无关');
assert.throws(() => finalizeExternalClips({ ...inbox, savedVersionId: approved.version.id }, base, [source], [base]), /已经保存/);

for (const changed of [
  { ...input, sources: { camera: 'D:/wrong.mp4' } },
  { ...input, ranges: [{ ...input.ranges[1], sourceId: 'outside' }] },
  { ...input, ranges: [{ ...input.ranges[1], end: 61 }] },
  { ...input, ranges: [{ ...input.ranges[1], start: -1 }] },
  { ...input, ranges: [input.ranges[1], input.ranges[1]] },
  { ...input, metadata: { originVersionId: 'wrong' } },
]) assert.throws(() => inspectExternalClips(changed, base, [source], 'bad.json'));
const wordSource = { ...source, transcript: [{ id: 't', text: '词语', start: 9, end: 11, words: [{ word: '词语', start: 9, end: 11 }] }] };
assert.throws(() => inspectExternalClips(input, base, [wordSource], 'word.json'), /词语内部/);
assert.throws(() => finalizeExternalClips(inbox, base, [wordSource], [base]), /词语内部/);
const wordInput = { ...input, ranges: [input.ranges[0], { ...input.ranges[1], start: 9 }] };
assert.equal(inspectExternalClips(wordInput, base, [wordSource], 'words.json').clips[0].boundaryStatus, 'word');

// Exercise the real project export/import path used by autosave, including pending and rejected records.
const state = useEditorStore.getState();
state.addSourceMedia(source);
state.setStoryAssembly(assembly);
state.setStoryAssemblyVersions([base, approved.version]);
state.setStoryVersionSelection({ winnerVersionId: base.id, comparedVersionIds: [base.id, base.id], rationale: '原胜出', rejectedReasons: {}, selectedAt: '' });
state.setExternalClipInboxes([inbox, rejected, inspectExternalClips(input, base, [source], 'pending.json')]);
const saved = state.exportProject();
state.setExternalClipInboxes([]);
state.importProject(saved);
const loaded = useEditorStore.getState();
assert.equal(loaded.externalClipInboxes.length, 3);
assert.equal(loaded.externalClipInboxes[1].clips[0].reason, '与叙事无关');
assert.equal(loaded.externalClipInboxes[2].clips[0].decision, 'pending');
assert.equal(loaded.storyVersionSelection?.winnerVersionId, base.id);
assert.deepEqual(loaded.storyAssembly, assembly);
assert.deepEqual(loaded.sourceMedia, [source]);
const restored = restoreSourceStoryVersion(loaded.storyAssemblyVersions[1], loaded.sourceMedia, director);
assert.equal(resolveSourceStoryAssembly(restored.assembly, restored.sources).length, 2);
assert.equal(restored.sources[0].roughCutPlan?.candidates[1].visualReview, undefined);
assert.equal(sourceStoryAssemblyReadiness(restored.assembly, restored.sources, director.updatedAt).ready, false);
assert.equal(restored.assembly.confirmedAt, undefined);
assert.equal(restored.assembly.preview, undefined);
assert.equal(restored.assembly.appliedAt, undefined);
const noPlanSource = { ...source, id: 'other', path: 'D:/other.mp4', roughCutPlan: undefined };
const another = { ...input, sources: { ...input.sources, other: noPlanSource.path }, ranges: [input.ranges[0], { ...input.ranges[1], source: 'other', sourceId: 'other' }] };
const otherInbox = inspectExternalClips(another, base, [source, noPlanSource], 'other.json');
Object.assign(otherInbox.clips[0], { decision: 'approve', mappingStatus: 'confirmed', boundaryConfirmed: true, visualStatus: 'approved', narrativeRole: 'proof' });
const otherVersion = finalizeExternalClips(otherInbox, base, [source, noPlanSource], [base]).version;
assert.equal(restoreSourceStoryVersion(otherVersion, [source, noPlanSource], director).sources[1].roughCutPlan?.candidates.length, 1);
console.log('External clip inbox checks passed: approval, rejection, pending, mapping, bounds, words, persistence and restoration.');
