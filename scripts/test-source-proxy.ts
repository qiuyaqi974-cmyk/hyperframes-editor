import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { generateSourceProxy, generateSourceVisualCheckpoint, generateSourceWaveform, inspectSourceMedia } from '../electron/sourceMedia';

const root = mkdtempSync(join(tmpdir(), 'hyperframes-source-proxy-'));
try {
  const input = join(root, 'source-with-audio.mp4');
  const generated = spawnSync(ffmpegInstaller.path, [
    '-y', '-f', 'lavfi', '-i', 'color=c=#123456:s=640x360:r=10:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input,
  ], { windowsHide: true, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const before = await inspectSourceMedia(input);
  const progress: number[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, value: { percent?: number }) => { if (typeof value.percent === 'number') progress.push(value.percent); },
  };
  const result = await generateSourceProxy(sender as never, 'test-source', input, root);
  assert.ok(existsSync(result.proxyPath));
  const proxy = await inspectSourceMedia(result.proxyPath);
  assert.equal(proxy.width, Math.min(960, before.width));
  assert.ok(Math.abs(proxy.duration - before.duration) < 0.2);
  assert.ok(progress.length > 0);
  const peaks = await generateSourceWaveform(input, 120);
  assert.equal(peaks.length, 120);
  assert.ok(peaks.some((peak) => peak > 0.01));
  const checkpoint = await generateSourceVisualCheckpoint(input, 0.4, 1.4, join(root, 'visual-cache'));
  assert.match(checkpoint.image, /^data:image\/jpeg;base64,\/9j\//);
  assert.equal(checkpoint.times.length, 9);
  assert.equal(checkpoint.cached, false);
  const cachedCheckpoint = await generateSourceVisualCheckpoint(input, 0.4, 1.4, join(root, 'visual-cache'));
  assert.equal(cachedCheckpoint.cached, true);
  assert.equal(cachedCheckpoint.image, checkpoint.image);
  console.log('Source proxy integration passed.');
} finally {
  const safeRoot = resolve(root);
  if (safeRoot.startsWith(resolve(tmpdir())) && safeRoot.includes('hyperframes-source-proxy-')) {
    rmSync(safeRoot, { recursive: true, force: true });
  }
}
