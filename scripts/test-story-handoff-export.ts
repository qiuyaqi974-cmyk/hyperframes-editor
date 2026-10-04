import assert from 'node:assert/strict';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyWinningStoryHandoff, writeWinningStoryHandoff } from '../electron/storyHandoff';
import type { WinningStoryHandoffPayload } from '../src/lib/sourceStoryHandoff';
import { createOtioTimeline, analyzeOtio } from '../src/lib/otioTimeline';
import { createFcpxmlTimeline } from '../src/lib/fcpxmlTimeline';
import type { ExternalMediaSource, SourceStoryAssemblyVersion } from '../src/types';

const root = mkdtempSync(join(tmpdir(), 'hyperframes-handoff-test-'));
try {
  const sourcePath = join(root, 'source.mp4');
  const generated = spawnSync(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath], { windowsHide: true });
  assert.equal(generated.status, 0, String(generated.stderr));
  const size = statSync(sourcePath).size;
  const payload: WinningStoryHandoffPayload = {
    version: 1, kind: 'hyperframes-winning-story-handoff', projectName: '导出测试', exportedAt: '',
    winner: { id: 'v1', label: '方案 A', note: '', rationale: '清楚', selectedAt: '' },
    sources: [{ id: 's1', alias: 'S001', name: 'source.mp4', path: sourcePath, expectedDuration: 2, expectedSize: size }],
    ranges: [{ index: 1, source: 'S001', sourceId: 's1', start: 0.2, end: 1.7, duration: 1.5, outputStart: 0, outputEnd: 1.5, label: '01 钩子', text: '测试', narrativeRole: 'hook' }],
    totalDuration: 1.5, edl: { version: 1, kind: 'hyperframes-story-edl', metadata: { projectName: '导出测试', originVersionId: 'v1', originVersionLabel: '方案 A', exportedAt: '', rationale: '清楚' }, sources: { S001: sourcePath }, ranges: [{ source: 'S001', sourceId: 's1', candidateId: 'c1', start: 0.2, end: 1.7, label: '01 钩子', beat: 'hook', quote: '测试' }] },
    subtitlesSrt: '1\n00:00:00,000 --> 00:00:01,500\n测试\n', clipListCsv: '\uFEFFtest', readme: '# test',
  };
  const verification = await verifyWinningStoryHandoff(payload);
  const otioSource = { id: 's1', name: 'source.mp4', path: sourcePath, duration: 2, size, width: 320, height: 180, status: 'original', createdAt: '' } satisfies ExternalMediaSource;
  const otioVersion: SourceStoryAssemblyVersion = { id: 'v1', label: '方案 A', note: '', createdAt: '', signature: '', assembly: { version: 1, generatedAt: '', directorUpdatedAt: '', sourceSignatures: {}, items: [] }, segments: [{ sourceId: 's1', candidateId: 'c1', sourceName: 'source.mp4', text: '测试', start: 0.2, end: 1.7, narrativeRole: 'hook' }] };
  payload.otio = createOtioTimeline(otioVersion, [otioSource], '导出测试');
  payload.fcpxml = createFcpxmlTimeline(otioVersion, [otioSource], '导出测试');
  assert.equal(verification.status, 'pass');
  assert.equal(verification.sources[0].quickSha256.length, 64);
  const result = await writeWinningStoryHandoff(root, payload);
  assert.equal(result.fileCount, 9);
  assert.equal(analyzeOtio(JSON.parse(readFileSync(join(result.outputPath, 'timeline.otio'), 'utf8'))).clips.length, 1);
  assert.match(readFileSync(join(result.outputPath, 'timeline.fcpxml'), 'utf8'), /<fcpxml version="1\.10">/);
  assert.ok(resolve(result.outputPath).startsWith(resolve(root)));
  for (const file of ['edl.json', 'sources.json', 'winner.json', 'verification.json', 'clip-list.csv', 'timeline.srt', 'README-剪映交接.md']) assert.ok(existsSync(join(result.outputPath, file)), file);
  assert.equal(existsSync(join(result.outputPath, 'source.mp4')), false, '交接包不应复制原片');
  const written = JSON.parse(readFileSync(join(result.outputPath, 'verification.json'), 'utf8')) as typeof verification;
  assert.equal(written.fingerprintMode, 'sha256-size-head-tail-1mb');
  await assert.rejects(() => verifyWinningStoryHandoff({ ...payload, sources: [{ ...payload.sources[0], expectedSize: size + 1 }] }), /大小已变化/);
  console.log('Story handoff export checks passed.');
} finally {
  const resolved = resolve(root);
  if (resolved.startsWith(resolve(tmpdir())) && resolved.includes('hyperframes-handoff-test-')) rmSync(resolved, { recursive: true, force: true });
}
