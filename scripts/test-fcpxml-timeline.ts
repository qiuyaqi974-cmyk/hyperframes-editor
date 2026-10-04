import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFcpxmlTimeline, fcpxmlToEdl, parseFcpxml } from '../src/lib/fcpxmlTimeline';
import { inspectExternalClips, finalizeExternalClips } from '../src/lib/externalClipInbox';
import { createSourceStoryVersion } from '../src/lib/sourceStoryVersions';
import { createWinningStoryHandoff } from '../src/lib/sourceStoryHandoff';
import { importRefinedStoryEdl } from '../src/lib/sourceStoryRoundtrip';
import { useEditorStore } from '../src/store/editorStore';
import type { ExternalMediaSource, SourceStoryAssembly } from '../src/types';

const source: ExternalMediaSource = { id: 'source&1', name: '中文 & source.mp4', path: 'D:/media/中文 & source.mp4', duration: 100, size: 10, width: 1920, height: 1080, status: 'original', createdAt: '', roughCutPlan: { version: 1, sourceId: 'source&1', generatedAt: '', strategy: { pauseThreshold: 0.45, paddingBefore: 0, paddingAfter: 0, pacing: 'balanced', objective: '', thesis: '' }, candidates: [10, 30].map((start, index) => ({ id: `c${index}`, start, end: start + 4, text: `片段 ${index} & <ok>`, decision: 'keep', boundary: 'manual', pauseBefore: null, pauseAfter: null, reason: '' })) } };
const director = useEditorStore.getState().director;
const assembly: SourceStoryAssembly = { version: 1, generatedAt: '', directorUpdatedAt: director.updatedAt, sourceSignatures: {}, items: [{ sourceId: source.id, candidateId: 'c0', narrativeRole: 'hook' }, { sourceId: source.id, candidateId: 'c1', narrativeRole: 'proof' }] };
const base = createSourceStoryVersion(assembly, [source], []);
const fcpxml = createFcpxmlTimeline(base, [source], '项目 & FCPXML', 30000 / 1001);

assert.match(fcpxml, /<fcpxml version="1\.10">/); assert.match(fcpxml, /<!DOCTYPE fcpxml>/);
assert.match(fcpxml, /frameDuration="1001\/30000s"/); assert.match(fcpxml, /%E4%B8%AD%E6%96%87%20%26%20source\.mp4/);
assert.match(fcpxml, /项目 &amp; FCPXML/); assert.equal(parseFcpxml(fcpxml).name, 'fcpxml');
const roundtrip = fcpxmlToEdl(fcpxml, base, [source]);
assert.deepEqual(roundtrip.ranges.map(({ sourceId, candidateId, start, end, beat, quote }) => ({ sourceId, candidateId, start, end, beat, quote })), [
  { sourceId: source.id, candidateId: 'c0', start: 10, end: 14, beat: 'hook', quote: '片段 0 & <ok>' },
  { sourceId: source.id, candidateId: 'c1', start: 30, end: 34, beat: 'proof', quote: '片段 1 & <ok>' },
]);

const blocks = [...fcpxml.matchAll(/          <asset-clip[\s\S]*?<\/asset-clip>/g)].map((match) => match[0]); assert.equal(blocks.length, 2);
const reordered = fcpxml.replace(blocks[0], '__FIRST__').replace(blocks[1], blocks[0].replace('offset="0s"', 'offset="4s"')).replace('__FIRST__', blocks[1].replace('offset="4s"', 'offset="0s"'));
const reorderedEdl = fcpxmlToEdl(reordered, base, [source]);
const imported = importRefinedStoryEdl(reorderedEdl, base, [source], [base], 'edited.fcpxml');
assert.deepEqual(imported.version.segments.map((segment) => segment.candidateId), ['c1', 'c0']);

const newClip = `          <asset-clip name="新增" ref="r2" offset="8s" start="40s" duration="3s" audioRole="dialogue">\n            <metadata>\n              <md key="com.hyperframes.sourceId" value="source&amp;1"/>\n              <md key="com.hyperframes.narrativeRole" value="turn"/>\n              <md key="com.hyperframes.text" value="新增动作"/>\n            </metadata>\n          </asset-clip>`;
const withNew = fcpxml.replace('duration="8s" tcStart', 'duration="11s" tcStart').replace('        </spine>', `${newClip}\n        </spine>`);
const addedEdl = fcpxmlToEdl(withNew, base, [source]);
const inbox = inspectExternalClips(addedEdl, base, [source], 'added.fcpxml'); assert.equal(inbox.clips.length, 1);
Object.assign(inbox.clips[0], { decision: 'approve', mappingStatus: 'confirmed', boundaryConfirmed: true, visualStatus: 'approved', narrativeRole: 'turn' });
const approved = finalizeExternalClips(inbox, base, [source], [base]).version;
assert.equal(approved.provenance?.kind, 'external-fcpxml'); assert.equal(approved.segments.at(-1)?.start, 40);

for (const [invalid, pattern] of [
  [fcpxml.replace(`value="${base.id}"`, 'value="wrong"'), /来源版本不匹配/],
  [fcpxml.replace('offset="4s"', 'offset="5s"'), /无间隙、无重叠/],
  [fcpxml.replace('<spine>', '<spine><transition name="bad"/>'), /暂不支持 spine 中的 transition/],
  [fcpxml.replace('version="1.10"', 'version="1.11"'), /只支持 FCPXML 1\.10/],
  [fcpxml.replace('<!DOCTYPE fcpxml>', '<!DOCTYPE fcpxml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'), /实体声明或内嵌 DTD/],
  [fcpxml.replace('file:///D:/media/', 'https://example.com/'), /绝对本地路径/],
] as const) assert.throws(() => fcpxmlToEdl(invalid, base, [source]), pattern);
assert.throws(() => parseFcpxml(`<fcpxml version="1.10"><event name="&unknown;"/></fcpxml>`), /未知 XML 实体/);
assert.throws(() => parseFcpxml(`<fcpxml>${' '.repeat(5 * 1024 * 1024)}</fcpxml>`), /5MB/);

const snapshot = { ...useEditorStore.getState().exportSnapshot(), projectName: 'FCPXML 交接', sourceMedia: [source], storyAssembly: { ...assembly, appliedAt: 'now', appliedBlockIds: ['block'] }, storyAssemblyVersions: [base], storyVersionSelection: { winnerVersionId: base.id, comparedVersionIds: [base.id, base.id] as [string, string], rationale: 'ok', rejectedReasons: {}, selectedAt: '' } };
const handoff = createWinningStoryHandoff(snapshot); assert(handoff.fcpxml); assert.equal(fcpxmlToEdl(handoff.fcpxml, base, [source]).ranges.length, 2);
if (process.env.FCPXML_CHECK_DIR) {
  const comparison = { ...structuredClone(base), id: 'fcpxml-ui-comparison', label: '方案 B', signature: 'fcpxml-ui-comparison-signature' };
  writeFileSync(join(process.env.FCPXML_CHECK_DIR, 'ui-snapshot.json'), JSON.stringify({ ...snapshot, storyAssembly: assembly, storyAssemblyVersions: [base, comparison], storyVersionSelection: { ...snapshot.storyVersionSelection, comparedVersionIds: [base.id, comparison.id] }, externalClipInboxes: [] }));
  writeFileSync(join(process.env.FCPXML_CHECK_DIR, 'reordered.fcpxml'), reordered);
}

console.log('FCPXML checks passed: official 1.10 structure, rational time, local URLs, XML escaping, export/import/reorder/new-clip review, provenance, profile/source/version/size/entity gates and handoff inclusion.');
