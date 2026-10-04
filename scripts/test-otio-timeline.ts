import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeOtio, createOtioTimeline, otioToEdl, otioPath } from '../src/lib/otioTimeline';
import { inspectExternalClips, finalizeExternalClips } from '../src/lib/externalClipInbox';
import { createSourceStoryVersion, restoreSourceStoryVersion } from '../src/lib/sourceStoryVersions';
import { createWinningStoryHandoff } from '../src/lib/sourceStoryHandoff';
import { analyzeProjectHealth } from '../src/lib/projectHealth';
import { useEditorStore } from '../src/store/editorStore';
import type { ExternalMediaSource, SourceStoryAssembly } from '../src/types';

// Mutable OTIO test fixtures deliberately exercise the public JSON interchange boundary.
type Obj = Record<string, any>;
const time = (value: number, rate = 30) => ({ OTIO_SCHEMA: 'RationalTime.1', value, rate });
const source: ExternalMediaSource = { id: 's', name: '中文 source.mp4', path: 'D:/media/中文 source.mp4', duration: 100, size: 10, width: 1280, height: 720, status: 'original', createdAt: '', roughCutPlan: { version: 1, sourceId: 's', generatedAt: '', strategy: { pauseThreshold: 0.45, paddingBefore: 0, paddingAfter: 0, pacing: 'balanced', objective: '', thesis: '' }, candidates: [10, 30].map((start, index) => ({ id: `c${index}`, start, end: start + 4, text: `片段 ${index}`, decision: 'keep', boundary: 'manual', pauseBefore: null, pauseAfter: null, reason: '' })) } };
const director = useEditorStore.getState().director;
const assembly: SourceStoryAssembly = { version: 1, generatedAt: '', directorUpdatedAt: director.updatedAt, sourceSignatures: {}, items: [{ sourceId: 's', candidateId: 'c0', narrativeRole: 'hook' }, { sourceId: 's', candidateId: 'c1', narrativeRole: 'proof' }] };
const base = createSourceStoryVersion(assembly, [source], []);
const simple = createOtioTimeline(base, [source], 'OTIO 测试', 30000 / 1001) as Obj;
assert.equal(analyzeOtio(simple).clips.length, 2);
assert.deepEqual(analyzeOtio(simple).blockers, []);
assert.equal(otioToEdl(simple, base, [source]).edl.ranges[0].start, 10);
assert.equal(otioPath('file:///D:/media/%E4%B8%AD%E6%96%87%20source.mp4'), source.path);
assert.equal(otioPath('file://server/share/a%20b.mp4'), '//server/share/a b.mp4');
assert.throws(() => otioPath('https://example.com/a.mp4'), /绝对本地路径/);
assert.throws(() => otioPath('../a.mp4'), /绝对本地路径/);
const simpleBox = inspectExternalClips(simple, base, [source], 'simple.otio');
const simpleVersion = finalizeExternalClips(simpleBox, base, [source], [base]).version;
assert.equal(simpleVersion.provenance?.kind, 'external-otio');
assert.equal(restoreSourceStoryVersion(simpleVersion, [source], director).assembly.confirmedAt, undefined);
assert.throws(() => finalizeExternalClips(simpleBox, base, [source], [base, simpleVersion]), /已经保存/);

const complex = structuredClone(simple);
const track = complex.tracks.children[0];
track.children[0].effects = [{ OTIO_SCHEMA: 'LinearTimeWarp.1', name: '2x', effect_name: 'LinearTimeWarp', time_scalar: 2, metadata: {} }];
track.children.splice(1, 0, { OTIO_SCHEMA: 'Transition.1', name: 'dissolve', transition_type: 'SMPTE_Dissolve', in_offset: time(6), out_offset: time(9), metadata: { custom: 'preserved' } });
const audio = structuredClone(simple.tracks.children[0]);
audio.name = 'A1'; audio.kind = 'Audio';
audio.children = [structuredClone(audio.children[1])];
complex.tracks.children.push(audio);
const original = JSON.stringify({ base, source, assembly, complex });
const info = analyzeOtio(complex);
assert.equal(info.duration, 8, 'OTIO timewarp and transition do not change the stored item duration');
assert.equal(info.clips[1].outputStart, 4);
assert.equal(info.clips[0].speed, 2);
assert.equal(info.transitions[0].inOffset, 0.2);
assert(info.blockers.includes('多轨叠加') && info.blockers.includes('转场') && info.blockers.includes('变速'));
const box = inspectExternalClips(complex, base, [source], 'complex.otio');
const version = finalizeExternalClips(box, base, [source], [base]).version;
assert.deepEqual(version.externalTimeline?.document, complex, 'full track, effect, transition and metadata preservation');
assert.throws(() => restoreSourceStoryVersion(version, [source], director), /禁止扁平化/);
assert.equal(JSON.stringify({ base, source, assembly, complex }), original);
const reexported = createOtioTimeline(version, [source], 'reexport') as Obj;
assert.deepEqual(reexported.tracks, complex.tracks);
assert.equal(reexported.metadata.hyperframes.originVersionId, version.id);

const changed = structuredClone(complex);
changed.tracks.children[0].children[0].effects[0].time_scalar = 1.5;
const changedVersion = finalizeExternalClips(inspectExternalClips(changed, base, [source], 'speed.otio'), base, [source], [base, version]).version;
assert.notDeepEqual(changedVersion.externalTimeline, version.externalTimeline, 'effect-only edits must be saveable');

const added = structuredClone(complex);
const addedClip = structuredClone(simple.tracks.children[0].children[0]);
delete addedClip.metadata.hyperframes.candidateId;
addedClip.source_range.start_time = time(1500);
addedClip.source_range.duration = time(90);
added.tracks.children[0].children.push(addedClip);
const addedBox = inspectExternalClips(added, base, [source], 'added.otio');
assert.equal(addedBox.clips.length, 1);
assert.throws(() => finalizeExternalClips(addedBox, base, [source], [base]), /最终决定/);
const rejected = structuredClone(addedBox);
rejected.clips[0].decision = 'reject'; rejected.clips[0].reason = '不相关';
const rejectedVersion = finalizeExternalClips(rejected, base, [source], [base]).version;
const rejectedDoc = rejectedVersion.externalTimeline!.document as Obj;
assert.equal(rejectedDoc.tracks.children[0].children.at(-1).OTIO_SCHEMA, 'Gap.1');
assert.equal(analyzeOtio(rejectedDoc).duration, 11, 'rejection preserves other track offsets');
Object.assign(addedBox.clips[0], { decision: 'approve', mappingStatus: 'confirmed', boundaryConfirmed: true, visualStatus: 'approved', narrativeRole: 'proof' });
const approvedVersion = finalizeExternalClips(addedBox, base, [source], [base]).version;
assert.equal((approvedVersion.externalTimeline!.document as Obj).tracks.children[0].children.at(-1).metadata.hyperframes.candidateId, addedBox.clips[0].id);

// Rejecting a transition neighbor must remove its transition, retain a gap, and retain the audit source.
const neighbor = structuredClone(complex);
delete neighbor.tracks.children[0].children[0].metadata.hyperframes.candidateId;
const neighborBox = inspectExternalClips(neighbor, base, [source], 'neighbor.otio');
Object.assign(neighborBox.clips[0], { decision: 'reject', reason: '无效镜头' });
const neighborVersion = finalizeExternalClips(neighborBox, base, [source], [base]).version;
assert.equal(analyzeOtio(neighborVersion.externalTimeline!.document).transitions.length, 0);
assert.equal(analyzeOtio(neighborBox.externalTimeline!.document).transitions.length, 1);

for (const mutate of [
  (doc: Obj) => { doc.metadata.hyperframes.originVersionId = 'wrong'; },
  (doc: Obj) => { delete doc.metadata.hyperframes.originVersionId; },
  (doc: Obj) => { doc.tracks.children[0].children[0].media_references.DEFAULT_MEDIA.target_url = 'file:///D:/wrong.mp4'; },
  (doc: Obj) => { doc.tracks.children[0].children[0].metadata.hyperframes.sourceId = 'unknown'; },
  (doc: Obj) => { doc.tracks.children[0].children[0].source_range.start_time = time(-1); },
  (doc: Obj) => { doc.tracks.children[0].children[0].source_range.duration = time(999999); },
  (doc: Obj) => { doc.tracks.children[0].children[0].source_range.duration.rate = 0; },
  (doc: Obj) => { doc.tracks.children[0].children[0].effects = [{ OTIO_SCHEMA: 'FreezeFrame.1' }]; },
  (doc: Obj) => { doc.tracks.children[0].children[0].effects = [{ OTIO_SCHEMA: 'LinearTimeWarp.1', time_scalar: -1 }]; },
  (doc: Obj) => { doc.tracks.children[0].children[0].OTIO_SCHEMA = 'Stack.1'; },
  (doc: Obj) => { doc.tracks.children[0].source_range = { OTIO_SCHEMA: 'TimeRange.1', start_time: time(0), duration: time(90) }; },
]) {
  const invalid = structuredClone(simple); mutate(invalid);
  assert.throws(() => inspectExternalClips(invalid, base, [source], 'invalid.otio'));
}
const wordSource = { ...source, transcript: [{ id: 'w', start: 9, end: 11, text: 'word', words: [{ word: 'word', start: 9, end: 11 }] }] };
assert.throws(() => inspectExternalClips(simple, base, [wordSource], 'word.otio'), /词语内部/);
const handles = structuredClone(complex); handles.tracks.children[0].children[2].source_range.start_time = time(0);
assert.throws(() => inspectExternalClips(handles, base, [source], 'handles.otio'), /原片范围/);
const tc = structuredClone(simple);
for (const item of tc.tracks.children[0].children) {
  item.media_references.DEFAULT_MEDIA.available_range.start_time = time(3600 * 30);
  item.source_range.start_time.value += 3600 * item.source_range.start_time.rate;
}
assert(Math.abs(otioToEdl(tc, base, [source]).edl.ranges[0].start - 10) < 1e-8, 'nonzero source timecode');

const state = useEditorStore.getState();
state.addSourceMedia(source); state.setStoryAssembly(assembly);
state.setStoryAssemblyVersions([base, version, approvedVersion]); state.setExternalClipInboxes([box, addedBox, rejected]);
state.setStoryVersionSelection({ winnerVersionId: version.id, comparedVersionIds: [base.id, version.id], rationale: 'test', rejectedReasons: {}, selectedAt: '' });
const snapshot = state.exportProject(); state.setExternalClipInboxes([]); state.importProject(snapshot);
const loaded = useEditorStore.getState();
assert.deepEqual(loaded.storyAssemblyVersions[1].externalTimeline?.document, complex);
assert.deepEqual(loaded.externalClipInboxes[0].externalTimeline?.document, complex);
assert(analyzeProjectHealth(loaded.exportSnapshot()).blockers.some((issue) => issue.id === 'otio-render-unsupported'));
const handoffSnapshot = { ...loaded.exportSnapshot(), storyAssemblyVersions: [base], storyVersionSelection: { winnerVersionId: base.id, comparedVersionIds: [base.id, base.id] as [string, string], rationale: 'ok', rejectedReasons: {}, selectedAt: '' }, storyAssembly: { ...assembly, appliedAt: 'now', appliedBlockIds: ['block'] } };
assert.equal(analyzeOtio(createWinningStoryHandoff(handoffSnapshot).otio).clips.length, 2);
if (process.env.OTIO_CHECK_DIR) {
  writeFileSync(join(process.env.OTIO_CHECK_DIR, 'ui-snapshot.json'), JSON.stringify({ ...handoffSnapshot, storyAssemblyVersions: [base, simpleVersion], externalClipInboxes: [] }));
  writeFileSync(join(process.env.OTIO_CHECK_DIR, 'simple.otio'), JSON.stringify(simple));
  writeFileSync(join(process.env.OTIO_CHECK_DIR, 'complex.otio'), JSON.stringify(complex));
  writeFileSync(join(process.env.OTIO_CHECK_DIR, 'approved.otio'), JSON.stringify(approvedVersion.externalTimeline!.document));
  writeFileSync(join(process.env.OTIO_CHECK_DIR, 'rejected.otio'), JSON.stringify(rejectedDoc));
}
console.log('OTIO checks passed: export/import, tracks, transitions, speeds, review, rejection timing, invalid data, persistence and RC gate.');
