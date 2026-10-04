import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { cancelReleaseRender, getReleaseRenderStatus, startReleaseRender } from '../electron/releaseRenderer';
import type { ReleaseRenderRequest, ReleaseRenderResult } from '../src/lib/releaseRender';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workDir = mkdtempSync(join(tmpdir(), 'hf-release-render-test-'));
const toolPath = join(root, 'tools', 'html-to-mp4.mjs');
const sourceAudioPath = join(workDir, 'source-audio.wav');
const audioCreated = spawnSync(ffmpegInstaller.path, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', sourceAudioPath], { encoding: 'utf8' });
assert.equal(audioCreated.status, 0, audioCreated.stderr);
const sourceAudioUrl = pathToFileURL(sourceAudioPath).href;
const html = `<!doctype html><html><body style="margin:0"><div id="stage" style="width:320px;height:180px;background:#123456;color:white;font:24px sans-serif;display:grid;place-items:center">RC TEST</div><script>
window.__HF_PROJECT={canvas:{width:320,height:180,fps:2},narration:null,scenes:[],blocks:[{type:'video',start:.5,duration:.4,props:{externalSourceId:'source-audio',src:${JSON.stringify(sourceAudioUrl)},sourceIn:0,muted:false}},{type:'video',start:1.5,duration:.4,props:{externalSourceId:'source-audio',src:${JSON.stringify(sourceAudioUrl)},sourceIn:.5,muted:false}}]};
window.__HF_SEEK=(time)=>{document.getElementById('stage').style.opacity=String(.5+.5*Math.sin(time));};
window.__HF_MOUNT_PLAYER=()=>{};
</script></body></html>`;
const request: ReleaseRenderRequest = {
  html,
  candidateId: 'rc-integration',
  candidateLabel: 'RC-007',
  projectName: '集成测试',
  candidateCreatedAt: '2026-03-01T00:00:00.000Z',
  snapshotUpdatedAt: '2026-03-01T00:00:00.000Z',
  directorUpdatedAt: '2026-03-01T00:00:00.000Z',
  width: 320,
  height: 180,
  fps: 2,
  duration: 6,
  health: { status: 'ready', blockers: 0, warnings: 0, directorIssues: 0 },
  reviewSummary: { approved: 1, pending: 0, changes: 0, redo: 0, unresolvedComments: 0 },
};

function run(outputPath: string, cancelOnProgress = false) {
  return new Promise<{ result: ReleaseRenderResult; progresses: number[] }>((resolve, reject) => {
    const progresses: number[] = [];
    let jobId = '';
    const timer = setTimeout(() => reject(new Error('Electron 渲染集成测试超时')), 45_000);
    const sender = {
      isDestroyed: () => false,
      send: (channel: string, payload: ReleaseRenderResult | { jobId: string; percent: number }) => {
        if (channel === 'release-render-progress' && 'percent' in payload) {
          progresses.push(payload.percent);
          if (cancelOnProgress && jobId) cancelReleaseRender(jobId);
        }
        if (channel === 'release-render-result') {
          clearTimeout(timer);
          resolve({ result: payload as ReleaseRenderResult, progresses });
        }
      },
    };
    try {
      jobId = startReleaseRender(sender as never, request, outputPath, toolPath).jobId;
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

try {
  const output = join(workDir, 'release.mp4');
  const completed = await run(output);
  assert.equal(completed.result.status, 'completed');
  assert(existsSync(output));
  const renderedProbe = spawnSync(ffmpegInstaller.path, ['-hide_banner', '-i', output], { encoding: 'utf8' });
  assert.match(renderedProbe.stderr, /Audio:/, '原片选段音轨应进入最终 MP4');
  assert(completed.progresses.length > 0);
  assert.equal(completed.progresses.at(-1), 100);
  const reportPath = join(workDir, 'release.render-report.json');
  assert(existsSync(reportPath));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.candidate.label, 'RC-007');
  assert.equal(report.video.fps, 2);
  assert.equal(report.reviewSummary.approved, 1);
  assert.match(report.sha256, /^[a-f0-9]{64}$/);
  assert(report.bytes > 0);
  assert.equal(getReleaseRenderStatus().status, 'completed');

  const canceledOutput = join(workDir, 'canceled.mp4');
  const canceled = await run(canceledOutput, true);
  assert.equal(canceled.result.status, 'canceled');
  assert.equal(existsSync(canceledOutput), false);
  assert.equal(readdirSync(workDir).some((name) => name.includes('.partial-')), false);
  assert.equal(getReleaseRenderStatus().status, 'canceled');

  console.log('Electron release render integration checks passed.');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
