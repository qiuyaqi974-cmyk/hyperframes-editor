import assert from 'node:assert/strict';
import { localPathToFileUrl, materializeExternalMediaForRender, parseEditDecisionList, parseSourceTranscript, searchSourceTranscript, sourceIdFor } from '../src/lib/sourceMedia';
import { scenePlanToSnapshot } from '../src/lib/agent/scenePlan';

const edl = parseEditDecisionList({
  version: 1,
  sources: { camera: 'D:\\footage\\cooking.mp4' },
  ranges: [
    { source: 'camera', start: 12.5, end: 25 },
    { source: 'camera', start: 90, end: 102.25, label: '出锅' },
  ],
});
assert.equal(edl.ranges.length, 2);
assert.equal(edl.ranges[1].label, '出锅');
assert.throws(() => parseEditDecisionList({ sources: {}, ranges: [{ source: 'x', start: 1, end: 2 }] }), /未知素材/);
assert.equal(sourceIdFor('same-path'), sourceIdFor('same-path'));
assert.equal(localPathToFileUrl('D:\\素材\\a b.mp4'), 'file:///D:/%E7%B4%A0%E6%9D%90/a%20b.mp4');

const snapshot = scenePlanToSnapshot({ projectName: '长视频测试', scenes: [] });
const sourceId = sourceIdFor('d:\\footage\\cooking.mp4');
snapshot.sourceMedia = [{
  id: sourceId,
  name: 'cooking.mp4',
  path: 'D:\\footage\\cooking.mp4',
  proxyPath: 'C:\\proxy\\cooking.mp4',
  duration: 7200,
  width: 3840,
  height: 2160,
  size: 10_000_000_000,
  status: 'proxy-ready',
  createdAt: '2026-09-19T00:00:00.000Z',
}];
snapshot.blocks.push({
  id: 'clip-1', type: 'video', name: '选段',
  props: { assetId: null, externalSourceId: sourceId, src: 'D:\\footage\\cooking.mp4', sourceIn: 12.5, sourceOut: 25, background: false, width: 1920, height: 1080, scale: 1, opacity: 1, loop: false, muted: true, playing: true, objectFit: 'cover' },
  animation: { type: 'none', duration: 0, delay: 0, easing: 'linear', direction: 'up', distance: 0, from: 1 },
  position: { x: 0, y: 0 }, start: 0, duration: 12.5, layer: 0, visible: true, locked: false,
});
const rendered = materializeExternalMediaForRender(snapshot);
const block = rendered.blocks[0];
assert.equal(block.type, 'video');
if (block.type === 'video') assert.match(block.props.src ?? '', /^file:\/\/\/D:\/footage\/cooking\.mp4$/);
assert.equal(snapshot.blocks[0].type === 'video' ? snapshot.blocks[0].props.src : '', 'D:\\footage\\cooking.mp4', '不得改写冻结快照');

const transcript = parseSourceTranscript(`WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n先把锅烧热\n\n00:00:08.500 --> 00:00:11.000\n现在放盐，然后准备出锅`);
assert.equal(transcript.length, 2);
assert.equal(transcript[1].start, 8.5);
assert.equal(searchSourceTranscript(transcript, '放盐 出锅')[0].text, '现在放盐，然后准备出锅');
assert.equal(searchSourceTranscript(transcript, '不存在').length, 0);

console.log('Source media checks passed.');
