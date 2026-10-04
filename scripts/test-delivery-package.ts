import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDeliveryPackage, createReleaseDeliveryPackage } from '../src/lib/exportDeliveryPackage';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { writeDeliveryPackage } from '../electron/deliveryPackage';
import type { ProjectSnapshot } from '../src/types';

const testRoot = mkdtempSync(join(tmpdir(), 'hyperframes-delivery-test-'));
const sourcePath = join(testRoot, 'long-source.mp4');
writeFileSync(sourcePath, Buffer.from('original-video-reference'));
const finalPath = join(testRoot, 'final-rc.mp4');
const reportPath = join(testRoot, 'final-rc.render-report.json');
writeFileSync(finalPath, Buffer.from('final-video'));
writeFileSync(reportPath, JSON.stringify({ sha256: 'a'.repeat(64) }));

const snapshot: ProjectSnapshot = {
  app: 'hyperframes-editor',
  version: 4,
  projectName: '交付测试',
  themeId: 'midnight',
  canvas: { width: 1920, height: 1080, fps: 30, background: '#000' },
  assets: [{
    id: 'hero',
    name: 'hero.png',
    kind: 'image',
    url: 'data:image/png;base64,iVBORw0KGgo=',
    width: 1,
    height: 1,
    size: 8,
  }],
  sourceMedia: [{
    id: 'source-long', name: 'long-source.mp4', path: sourcePath, duration: 7200,
    width: 3840, height: 2160, size: 24, status: 'original', createdAt: new Date(0).toISOString(),
    waveform: { peaks: [0.1, 0.8, 0.2], generatedAt: new Date(0).toISOString() },
    transcript: [{ id: 'line-1', start: 10, end: 12, text: '开始做饭', words: [{ start: 10, end: 10.5, word: '开始' }] }],
    transcription: { backend: 'faster-whisper', model: 'small', language: 'zh', generatedAt: new Date(0).toISOString(), wordTimestamps: true },
    eventMarkers: [{ id: 'event-1', label: '成品展示', start: 20, end: 24, kind: 'highlight', createdAt: new Date(0).toISOString(), visualConfirmed: true }],
    roughCutPlan: { version: 1, sourceId: 'source-long', generatedAt: new Date(0).toISOString(), strategy: { pauseThreshold: 0.45, paddingBefore: 0.05, paddingAfter: 0.08, pacing: 'balanced', objective: '保留步骤', thesis: '做饭', directorUpdatedAt: new Date(0).toISOString() }, candidates: [{ id: 'rough-1', start: 9.95, end: 12.08, text: '开始做饭', decision: 'keep', boundary: 'word', pauseBefore: null, pauseAfter: null, reason: '逐词边界 · 画面需人工确认', narrativeRole: 'hook', visualReview: { status: 'approved', checkedAt: new Date(0).toISOString(), windowStart: 9.5, windowEnd: 12.5 } }], assembly: { order: ['rough-1'], confirmedAt: new Date(1).toISOString() } },
  }],
  storyAssembly: { version: 1, generatedAt: new Date(0).toISOString(), directorUpdatedAt: new Date(0).toISOString(), sourceSignatures: { 'source-long': 'fixture-signature' }, items: [{ sourceId: 'source-long', candidateId: 'rough-1', narrativeRole: 'hook' }], confirmedAt: new Date(1).toISOString(), preview: { path: 'D:/story-preview.mp4', duration: 2.13, generatedAt: new Date(2).toISOString(), structureFingerprint: 'fixture-preview', boundaries: [], reviewedAt: new Date(3).toISOString() } },
  reviews: {
    'scene-review': { sceneId: 'scene-review', status: 'approved', comments: [], updatedAt: new Date(0).toISOString() },
  },
  narration: null,
  scenes: [],
  blocks: [
    {
      id: 'image-1',
      type: 'image',
      name: '主图',
      props: { assetId: 'hero', src: 'data:image/png;base64,iVBORw0KGgo=', width: 100, height: 100, scale: 1, opacity: 1, rotation: 0, radius: 0 },
      animation: { type: 'fade', duration: 0.3, delay: 0, easing: 'easeOut', direction: 'up', distance: 20, from: 0.9 },
      position: { x: 0, y: 0 },
      start: 3,
      duration: 4,
      layer: 0,
      visible: true,
      locked: false,
    },
    {
      id: 'text-1',
      type: 'text',
      name: '标题',
      props: { text: '重叠标题', fontSize: 48, color: '#fff', fontWeight: 700, letterSpacing: 0, lineHeight: 1.2, opacity: 1, align: 'left', maxWidth: 900 },
      animation: { type: 'none', duration: 0, delay: 0, easing: 'linear', direction: 'up', distance: 0, from: 1 },
      position: { x: 10, y: 10 },
      start: 3.5,
      duration: 1,
      layer: 1,
      visible: true,
      locked: false,
    },
  ],
  updatedAt: new Date(0).toISOString(),
  director: {
    objective: '交付测试', audience: '剪辑师', thesis: '保留导演意图', contentType: 'knowledge', tone: '克制', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '不使用花哨转场', scenes: {}, updatedAt: new Date(0).toISOString(),
  },
};

snapshot.storyAssemblyVersions = [{
  id: 'story-version-a', label: '方案 A', note: '交付版本', createdAt: new Date(4).toISOString(), signature: 'fixture-version',
  assembly: snapshot.storyAssembly!,
  segments: [{ sourceId: 'source-long', candidateId: 'rough-1', sourceName: 'long-source.mp4', text: '开始做饭', start: 9.95, end: 12.08, narrativeRole: 'hook' }],
}];
snapshot.storyVersionSelection = { winnerVersionId: 'story-version-a', comparedVersionIds: ['story-version-a', 'story-version-a'], rationale: '结构最清楚', rejectedReasons: {}, selectedAt: new Date(5).toISOString() };

const payload = createDeliveryPackage(snapshot);
assert.deepEqual(payload.manifest.blocks.map((block) => block.startTime), [3, 3.5]);
assert.equal(payload.manifest.duration, 7);
assert.equal(payload.manifest.assets[0]?.path, 'images/hero.png');
assert.equal(payload.externalFiles.length, 1);
assert.equal(payload.sourceIndex[0].transcript?.[0].text, '开始做饭');
assert.equal(payload.sourceIndex[0].transcription?.wordTimestamps, true);
assert.equal(payload.sourceIndex[0].eventMarkers?.[0].label, '成品展示');
assert.equal(payload.sourceIndex[0].roughCutPlan?.candidates[0].decision, 'keep');
assert.equal(payload.sourceIndex[0].roughCutPlan?.candidates[0].visualReview?.status, 'approved');
assert.equal(payload.sourceIndex[0].roughCutPlan?.candidates[0].narrativeRole, 'hook');
assert.deepEqual(payload.sourceIndex[0].roughCutPlan?.assembly?.order, ['rough-1']);
assert.equal(payload.manifest.storyAssembly?.items[0].candidateId, 'rough-1');
assert.equal(payload.sceneplan.storyAssembly?.confirmedAt, new Date(1).toISOString());
assert.equal(payload.sceneplan.storyAssembly?.preview?.reviewedAt, new Date(3).toISOString());
assert.equal(payload.manifest.storyAssemblyVersions?.[0].label, '方案 A');
assert.equal(payload.sceneplan.storyAssemblyVersions?.[0].segments[0].start, 9.95);
assert.equal(payload.manifest.storyVersionSelection?.rationale, '结构最清楚');
assert.equal('src' in payload.manifest.blocks[0].props, false);
assert.equal(payload.manifest.director?.visualRules, '不使用花哨转场');
assert.equal(payload.sceneplan.reviews?.['scene-review'].status, 'approved');

try {
  const output = writeDeliveryPackage(testRoot, payload);
  assert.ok(resolve(output).startsWith(resolve(testRoot)));
  assert.ok(existsSync(join(output, 'images', 'hero.png')));
  assert.ok(existsSync(join(output, 'videos', 'source-long.mp4')));
  assert.ok(existsSync(join(output, 'source-index.json')));
  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')) as typeof payload.manifest;
  assert.equal(manifest.duration, 7);
  const secondOutput = writeDeliveryPackage(testRoot, payload);
  assert.notEqual(secondOutput, output, '重复导出不应覆盖已有交付包');
  const candidate = createReleaseCandidate(snapshot, [], new Date('2026-09-19T00:00:00.000Z'));
  assert.equal(candidate.storyDecision?.label, '方案 A');
  candidate.render = { outputPath: finalPath, reportPath, sha256: 'a'.repeat(64), renderedAt: '2026-09-19T00:01:00.000Z' };
  const releasePayload = createReleaseDeliveryPackage(candidate);
  const releaseOutput = writeDeliveryPackage(testRoot, releasePayload);
  assert.ok(existsSync(join(releaseOutput, 'release.json')));
  assert.ok(existsSync(join(releaseOutput, 'final', 'final-rc.mp4')));
  assert.ok(existsSync(join(releaseOutput, 'reports', 'final-rc.render-report.json')));
  const release = JSON.parse(readFileSync(join(releaseOutput, 'release.json'), 'utf8')) as typeof releasePayload.release;
  assert.equal(release?.candidateLabel, 'RC-001');
  assert.equal(release?.storyDecision?.versionId, 'story-version-a');
  assert.equal(release?.finalRender?.sha256, 'a'.repeat(64));
  assert.equal(release?.finalRender?.renderedAt, '2026-09-19T00:01:00.000Z');
  assert.equal(releasePayload.manifest.release?.candidateId, candidate.id);
  assert.throws(
    () => writeDeliveryPackage(testRoot, { ...payload, folderName: '../escape' }),
    /文件夹名称无效/,
  );
  console.log('delivery package test passed');
} finally {
  const resolved = resolve(testRoot);
  if (resolved.startsWith(resolve(tmpdir())) && resolved.includes('hyperframes-delivery-test-')) {
    rmSync(resolved, { recursive: true, force: true });
  }
}
