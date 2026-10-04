import assert from 'node:assert/strict';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { WebContents } from 'electron';
import { generateSourceStoryPreview } from '../electron/sourceStoryPreview';
import type { SourceStoryPreviewProgress, SourceStoryPreviewRequest } from '../src/lib/sourceStoryPreview';

const root = mkdtempSync(join(tmpdir(), 'hyperframes-story-preview-'));
const first = join(root, 'camera-a.mp4');
const second = join(root, 'camera-b.mp4');

function ffmpeg(args: string[]) {
  const result = spawnSync(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg failed: ${result.status}`);
}

try {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=1.2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', first]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:size=320x240:rate=24:duration=1.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', second]);
  const progress: SourceStoryPreviewProgress[] = [];
  const sender = { isDestroyed: () => false, send: (_channel: string, value: SourceStoryPreviewProgress) => progress.push(value) } as unknown as WebContents;
  const request: SourceStoryPreviewRequest = {
    jobId: 'integration-preview-1', structureFingerprint: 'structure-v1',
    segments: [
      { sourcePath: first, sourceName: 'camera-a.mp4', start: 0.1, end: 0.9, narrativeRole: 'hook' },
      { sourcePath: second, sourceName: 'camera-b.mp4', start: 0.2, end: 1.0, narrativeRole: 'proof' },
    ],
  };
  const result = await generateSourceStoryPreview(sender, request, join(root, 'previews'));
  assert.equal(result.cached, false);
  assert.ok(existsSync(result.path));
  assert.equal(result.boundaries.length, 1);
  assert.equal(result.boundaries[0].outputTime, 0.8);
  assert.ok(Math.abs(result.duration - 1.6) < 0.25, `unexpected duration ${result.duration}`);
  assert.equal(progress.at(-1)?.percent, 100);
  assert.equal(readdirSync(join(root, 'previews', 'segments')).filter((name) => name.endsWith('.mp4')).length, 2);
  const cached = await generateSourceStoryPreview(sender, { ...request, jobId: 'integration-preview-2' }, join(root, 'previews'));
  assert.equal(cached.cached, true);
  assert.equal(cached.path, result.path);
  const revised = await generateSourceStoryPreview(sender, { ...request, jobId: 'integration-preview-3', structureFingerprint: 'structure-v2', segments: request.segments.map((segment, index) => index === 1 ? { ...segment, end: 0.95 } : segment) }, join(root, 'previews'));
  assert.equal(revised.cached, false);
  assert.equal(readdirSync(join(root, 'previews', 'segments')).filter((name) => name.endsWith('.mp4')).length, 3, '只应为变化的片段增加一个缓存文件');
  console.log('Source story preview integration checks passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
