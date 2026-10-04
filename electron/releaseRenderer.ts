import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { WebContents } from 'electron';
import type { ReleaseRenderProgress, ReleaseRenderRequest, ReleaseRenderResult, ReleaseRenderStatusSnapshot } from '../src/lib/releaseRender';

interface ActiveRender {
  jobId: string;
  child: ChildProcess;
  canceled: boolean;
  outputPath: string;
  workingOutputPath: string;
  tempDir: string;
}

let activeRender: ActiveRender | null = null;
let renderStatus: ReleaseRenderStatusSnapshot = { jobId: '', status: 'idle', percent: 0 };

export function getReleaseRenderStatus(): ReleaseRenderStatusSnapshot {
  return { ...renderStatus };
}

function safeName(value: string) {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').replace(/^\.+|\.+$/g, '').slice(0, 80) || 'hyperframes-video';
}

export function defaultRenderFilename(request: ReleaseRenderRequest) {
  return `${safeName(request.projectName)}-${safeName(request.candidateLabel)}.mp4`;
}

function send(sender: WebContents, channel: string, payload: unknown) {
  if (!sender.isDestroyed()) sender.send(channel, payload);
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function startReleaseRender(
  sender: WebContents,
  request: ReleaseRenderRequest,
  outputPath: string,
  toolPath: string,
) {
  if (activeRender) throw new Error('已有渲染任务正在运行，请完成或取消后再试。');
  if (!request.html.includes('__HF_MOUNT_PLAYER')) throw new Error('候选版本缺少可渲染的播放器内容。');
  if (!request.candidateId || !request.candidateLabel) throw new Error('候选版本标识无效。');
  if (request.health.blockers > 0) throw new Error('候选版本仍有阻断项，不能进入最终渲染。');
  if (request.width < 16 || request.height < 16 || request.fps < 1 || request.duration <= 0) throw new Error('候选版本的画布或时间参数无效。');
  mkdirSync(dirname(outputPath), { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), 'hyperframes-rc-'));
  const htmlPath = join(tempDir, `${safeName(request.candidateLabel)}.render.html`);
  writeFileSync(htmlPath, request.html, 'utf8');
  const jobId = `render-${Date.now().toString(36)}`;
  const workingOutputPath = `${outputPath}.partial-${jobId}.mp4`;
  const child = spawn(process.execPath, [toolPath, htmlPath, workingOutputPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  activeRender = { jobId, child, canceled: false, outputPath, workingOutputPath, tempDir };
  renderStatus = { jobId, candidateId: request.candidateId, candidateLabel: request.candidateLabel, status: 'rendering', percent: 0, outputPath };

  let log = '';
  let stdoutBuffer = '';
  const consume = (chunk: Buffer | string) => {
    const text = String(chunk);
    log = `${log}${text}`.slice(-12000);
    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const match = /HF_PROGRESS:(\d+):(\d+):(\d+)/.exec(line);
      if (!match) continue;
      const progress: ReleaseRenderProgress = {
        jobId,
        status: 'rendering',
        percent: Number(match[1]),
        frame: Number(match[2]),
        totalFrames: Number(match[3]),
      };
      renderStatus = { ...renderStatus, jobId, status: 'rendering', percent: progress.percent };
      send(sender, 'release-render-progress', progress);
    }
  };
  child.stdout.on('data', consume);
  child.stderr.on('data', (chunk) => { log = `${log}${String(chunk)}`.slice(-12000); });
  child.on('error', (error) => { log = `${log}\n${error.message}`.slice(-12000); });
  child.on('close', async (code) => {
    const wasCanceled = activeRender?.jobId === jobId && activeRender.canceled;
    activeRender = null;
    try {
      if (wasCanceled) {
        if (existsSync(workingOutputPath)) rmSync(workingOutputPath, { force: true });
        const result: ReleaseRenderResult = { jobId, status: 'canceled' };
        renderStatus = { ...renderStatus, jobId, status: 'canceled', percent: renderStatus.percent };
        send(sender, 'release-render-result', result);
        return;
      }
      if (code !== 0 || !existsSync(workingOutputPath)) {
        if (existsSync(workingOutputPath)) rmSync(workingOutputPath, { force: true });
        const result: ReleaseRenderResult = { jobId, status: 'failed', error: log.trim().slice(-1200) || `渲染进程退出码 ${code}` };
        renderStatus = { ...renderStatus, jobId, status: 'failed', percent: renderStatus.percent, error: result.error };
        send(sender, 'release-render-result', result);
        return;
      }
      const sha256 = await sha256File(workingOutputPath);
      const bytes = statSync(workingOutputPath).size;
      if (existsSync(outputPath)) rmSync(outputPath, { force: true });
      renameSync(workingOutputPath, outputPath);
      const reportPath = outputPath.replace(/\.mp4$/i, '') + '.render-report.json';
      writeFileSync(reportPath, JSON.stringify({
        schemaVersion: 1,
        renderer: 'hyperframes-editor',
        renderedAt: new Date().toISOString(),
        candidate: {
          id: request.candidateId,
          label: request.candidateLabel,
          createdAt: request.candidateCreatedAt,
          snapshotUpdatedAt: request.snapshotUpdatedAt,
          directorUpdatedAt: request.directorUpdatedAt,
        },
        projectName: request.projectName,
        output: basename(outputPath),
        sha256,
        bytes,
        video: { width: request.width, height: request.height, fps: request.fps, duration: request.duration },
        health: request.health,
        reviewSummary: request.reviewSummary,
      }, null, 2), 'utf8');
      const result: ReleaseRenderResult = { jobId, status: 'completed', outputPath, reportPath, sha256 };
      renderStatus = { ...renderStatus, jobId, status: 'completed', percent: 100, outputPath, reportPath, sha256 };
      send(sender, 'release-render-result', result);
    } catch (error) {
      if (existsSync(workingOutputPath)) rmSync(workingOutputPath, { force: true });
      const result: ReleaseRenderResult = { jobId, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      renderStatus = { ...renderStatus, jobId, status: 'failed', percent: renderStatus.percent, error: result.error };
      send(sender, 'release-render-result', result);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
  return { jobId, outputPath };
}

export function cancelReleaseRender(jobId: string) {
  if (!activeRender || activeRender.jobId !== jobId) return false;
  if (activeRender.canceled) return true;
  activeRender.canceled = true;
  if (process.platform === 'win32' && activeRender.child.pid) {
    const killer = spawn('taskkill', ['/pid', String(activeRender.child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.unref();
  } else {
    activeRender.child.kill('SIGTERM');
  }
  return true;
}
