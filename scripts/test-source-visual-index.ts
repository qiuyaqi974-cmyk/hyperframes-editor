import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { detectSourceVisualChanges, generateSourceVisualIndex, generateSourceVisualRefinement } from '../electron/sourceVisualIndex';
import { selectVisualAnalysisFrames, selectVisualIndexSamples, selectVisualRefinementBudget, selectVisualRefinementSamples } from '../src/lib/sourceVisualIndex';

assert.deepEqual(selectVisualIndexSamples(60, [], 24, 10).map((sample) => sample.time), [5, 15, 25, 35, 45, 55]);
assert.equal(selectVisualIndexSamples(1800, [], 24, 10).length, 24);
assert.equal(selectVisualIndexSamples(60, [20], 24, 10)[2].reason, 'change');
assert.throws(() => selectVisualIndexSamples(60, [], 61, 10));
assert.throws(() => selectVisualIndexSamples(60, [], 24, 0));
assert.deepEqual(selectVisualRefinementSamples(10, 20, 4).map((sample) => sample.time), [12, 14, 16, 18]);
assert.equal(selectVisualRefinementSamples(10, 20, 4)[0].windowStart, 10);
assert.equal(selectVisualRefinementSamples(10, 20, 4)[3].windowEnd, 20);
assert.throws(() => selectVisualRefinementSamples(0, 121, 6), /120/);
const analysisFrames = [
  { time: 0, windowStart: 0, windowEnd: 5, reason: 'coverage' as const },
  { time: 10, windowStart: 5, windowEnd: 12, reason: 'change' as const },
  { time: 11, windowStart: 10, windowEnd: 15, reason: 'coverage' as const },
  { time: 20, windowStart: 15, windowEnd: 25, reason: 'change' as const },
  { time: 30, windowStart: 25, windowEnd: 30, reason: 'coverage' as const },
];
assert.deepEqual(selectVisualAnalysisFrames(analysisFrames, 3).map((frame) => frame.time), [0, 10, 30]);
assert.deepEqual(selectVisualAnalysisFrames(analysisFrames, 4).map((frame) => frame.time), [0, 10, 20, 30]);
assert.equal(selectVisualAnalysisFrames(analysisFrames, 1)[0].reason, 'change');
assert.deepEqual(selectVisualAnalysisFrames(analysisFrames, 0), []);
assert.throws(() => selectVisualAnalysisFrames(analysisFrames, 13), /0–12/);
assert.equal(selectVisualRefinementBudget(12, 2), 6);
assert.equal(selectVisualRefinementBudget(5, 2), 3);
assert.equal(selectVisualRefinementBudget(5, 4), 0);
assert.equal(selectVisualRefinementBudget(4, 2), 2);
assert.throws(() => selectVisualRefinementBudget(-1, 2), /剩余图片预算/);

const root = mkdtempSync(join(tmpdir(), 'hyperframes-visual-index-'));
try {
  const sourcePath = join(root, 'source.mp4');
  const generated = spawnSync(ffmpegInstaller.path, [
    '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=4:d=3',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=4:d=3',
    '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=4:d=3',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]',
    '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
  ], { windowsHide: true, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const changes = await detectSourceVisualChanges(sourcePath);
  assert.ok(changes.some((time) => Math.abs(time - 3) < 0.6), `missing cut at 3s: ${changes}`);
  assert.ok(changes.some((time) => Math.abs(time - 6) < 0.6), `missing cut at 6s: ${changes}`);
  const first = await generateSourceVisualIndex(sourcePath, join(root, 'cache'), 12, 2);
  assert.equal(first.frames.length, 5);
  assert.ok(first.frames.some((frame) => frame.reason === 'change'));
  assert.ok(first.frames.every((frame) => frame.image.startsWith('data:image/jpeg;base64,/9j/')));
  assert.equal(first.cached, false);
  const second = await generateSourceVisualIndex(sourcePath, join(root, 'cache'), 12, 2);
  assert.equal(second.cached, true);
  assert.deepEqual(second.frames, first.frames);
  const refinement = await generateSourceVisualRefinement(sourcePath, join(root, 'cache'), 1, 5, 6);
  assert.equal(refinement.frames.length, 6);
  assert.ok(refinement.frames.every((frame) => frame.time > 1 && frame.time < 5));
  assert.ok(refinement.frames.every((frame) => frame.image.startsWith('data:image/jpeg;base64,/9j/')));
  assert.equal(refinement.cached, false);
  assert.equal((await generateSourceVisualRefinement(sourcePath, join(root, 'cache'), 1, 5, 6)).cached, true);
  assert.ok(existsSync(sourcePath));
  console.log('Local visual index integration passed.');
} finally {
  const safeRoot = resolve(root);
  if (safeRoot.startsWith(resolve(tmpdir())) && safeRoot.includes('hyperframes-visual-index-')) rmSync(safeRoot, { recursive: true, force: true });
}
