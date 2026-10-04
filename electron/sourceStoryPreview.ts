import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { WebContents } from 'electron';
import type { SourceStoryPreviewProgress, SourceStoryPreviewRequest, SourceStoryPreviewResult } from '../src/lib/sourceStoryPreview';
import { inspectSourceMedia, isSupportedSource } from './sourceMedia';

interface ActivePreviewJob {
  cancelled: boolean;
  child?: ReturnType<typeof spawn>;
}

const activePreviewJobs = new Map<string, ActivePreviewJob>();
const audioPresenceCache = new Map<string, boolean>();

const roleLabel = {
  hook: 'HOOK', context: 'CONTEXT', argument: 'CORE', proof: 'PROOF', turn: 'TURN', cta: 'CTA', custom: 'CUSTOM',
} as const;

function safeLabel(value: string) {
  return value.replace(/[\\:'%,;\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
}

function previewBoundaries(request: SourceStoryPreviewRequest) {
  let cursor = 0;
  return request.segments.slice(0, -1).map((segment, index) => {
    cursor += segment.end - segment.start;
    return { outputTime: Number(cursor.toFixed(3)), beforeIndex: index, afterIndex: index + 1 };
  });
}

function sendProgress(sender: WebContents, progress: SourceStoryPreviewProgress) {
  if (!sender.isDestroyed()) sender.send('source-story-preview-progress', progress);
}

function runFfmpeg(job: ActivePreviewJob, args: string[], onTime?: (seconds: number) => void) {
  return new Promise<void>((resolve, reject) => {
    if (job.cancelled) return reject(new Error('预览生成已取消。'));
    const child = spawn(ffmpegInstaller.path, args, { windowsHide: true });
    job.child = child;
    let log = '';
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      log = `${log}${text}`.slice(-12000);
      const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
      const match = matches[matches.length - 1];
      if (match && onTime) onTime(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      job.child = undefined;
      if (job.cancelled) reject(new Error('预览生成已取消。'));
      else if (code === 0) resolve();
      else reject(new Error(log.trim().slice(-1200) || `预览生成失败，退出码 ${code}`));
    });
  });
}

function sourceHasAudio(path: string) {
  const cached = audioPresenceCache.get(path);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise<boolean>((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, ['-hide_banner', '-i', path], { windowsHide: true });
    let log = '';
    child.stderr.on('data', (chunk) => { log = `${log}${String(chunk)}`.slice(-24000); });
    child.on('error', reject);
    child.on('close', () => {
      const present = /Audio:/i.test(log);
      audioPresenceCache.set(path, present);
      resolve(present);
    });
  });
}

export function cancelSourceStoryPreview(jobId: string) {
  const job = activePreviewJobs.get(jobId);
  if (!job) return false;
  job.cancelled = true;
  job.child?.kill();
  return true;
}

export async function generateSourceStoryPreview(sender: WebContents, request: SourceStoryPreviewRequest, outputRoot: string): Promise<SourceStoryPreviewResult> {
  if (!request.jobId || !request.segments.length) throw new Error('全局故事结构中没有可预览片段。');
  if (activePreviewJobs.has(request.jobId)) throw new Error('这份结构正在生成预览。');
  for (const segment of request.segments) {
    if (!isSupportedSource(segment.sourcePath)) throw new Error(`找不到预览原片：${segment.sourceName}`);
    if (!(segment.end > segment.start)) throw new Error(`片段边界无效：${segment.sourceName}`);
  }
  mkdirSync(outputRoot, { recursive: true });
  const sourceState = request.segments.map((segment) => {
    const stat = statSync(segment.sourcePath);
    return [segment.sourcePath.toLowerCase(), stat.size, stat.mtimeMs, segment.start, segment.end, segment.narrativeRole];
  });
  const key = createHash('sha256').update(JSON.stringify({ version: 2, fingerprint: request.structureFingerprint, sourceState })).digest('hex');
  const outputPath = join(outputRoot, `${key}.mp4`);
  const boundaries = previewBoundaries(request);
  const expectedDuration = request.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  if (existsSync(outputPath)) {
    const inspection = await inspectSourceMedia(outputPath);
    return { jobId: request.jobId, path: outputPath, duration: inspection.duration, cached: true, structureFingerprint: request.structureFingerprint, boundaries };
  }

  const job: ActivePreviewJob = { cancelled: false };
  activePreviewJobs.set(request.jobId, job);
  const workDir = mkdtempSync(join(outputRoot, 'preview-job-'));
  const segmentRoot = join(outputRoot, 'segments');
  mkdirSync(segmentRoot, { recursive: true });
  const segmentPaths: string[] = [];
  try {
    const fontFile = existsSync('C:\\Windows\\Fonts\\msyh.ttc') ? "fontfile='C\\:/Windows/Fonts/msyh.ttc':" : '';
    for (let index = 0; index < request.segments.length; index += 1) {
      const segment = request.segments[index];
      const duration = segment.end - segment.start;
      const label = safeLabel(`#${String(index + 1).padStart(2, '0')}  ${roleLabel[segment.narrativeRole]}  ${basename(segment.sourceName, extname(segment.sourceName))}`);
      const sourceStat = statSync(segment.sourcePath);
      const segmentKey = createHash('sha256').update(JSON.stringify({ version: 2, path: segment.sourcePath.toLowerCase(), size: sourceStat.size, mtime: sourceStat.mtimeMs, start: segment.start, end: segment.end, role: segment.narrativeRole, label })).digest('hex');
      const segmentPath = join(segmentRoot, `${segmentKey}.mp4`);
      segmentPaths.push(segmentPath);
      if (existsSync(segmentPath)) {
        sendProgress(sender, { jobId: request.jobId, phase: 'extracting', segmentIndex: index, segmentCount: request.segments.length, percent: Math.round((index + 1) / request.segments.length * 85) });
        continue;
      }
      const videoFilter = `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1,drawbox=x=18:y=18:w=iw-36:h=58:color=black@0.62:t=fill,drawtext=${fontFile}text='${label}':x=34:y=32:fontsize=24:fontcolor=white`;
      const audioFilter = `afade=t=in:st=0:d=0.03,afade=t=out:st=${Math.max(0, duration - 0.03).toFixed(3)}:d=0.03`;
      const hasAudio = await sourceHasAudio(segment.sourcePath);
      const inputArgs = ['-ss', segment.start.toFixed(3), '-t', duration.toFixed(3), '-i', segment.sourcePath];
      if (!hasAudio) inputArgs.push('-f', 'lavfi', '-t', duration.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      await runFfmpeg(job, [
        '-hide_banner', '-y', ...inputArgs,
        '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0', '-vf', videoFilter, '-af', audioFilter,
        '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', segmentPath,
      ], (seconds) => sendProgress(sender, { jobId: request.jobId, phase: 'extracting', segmentIndex: index, segmentCount: request.segments.length, percent: Math.min(84, Math.round((index + Math.min(1, seconds / duration)) / request.segments.length * 85)) }));
      sendProgress(sender, { jobId: request.jobId, phase: 'extracting', segmentIndex: index, segmentCount: request.segments.length, percent: Math.round((index + 1) / request.segments.length * 85) });
    }
    const concatPath = join(workDir, 'concat.txt');
    writeFileSync(concatPath, segmentPaths.map((path) => `file '${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    sendProgress(sender, { jobId: request.jobId, phase: 'joining', segmentCount: request.segments.length, percent: 90 });
    await runFfmpeg(job, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', outputPath]);
    sendProgress(sender, { jobId: request.jobId, phase: 'verifying', segmentCount: request.segments.length, percent: 97 });
    const inspection = await inspectSourceMedia(outputPath);
    if (Math.abs(inspection.duration - expectedDuration) > Math.max(0.5, request.segments.length / 24 + 0.15)) {
      throw new Error(`预览时长校验失败：预计 ${expectedDuration.toFixed(2)}s，实际 ${inspection.duration.toFixed(2)}s。`);
    }
    sendProgress(sender, { jobId: request.jobId, phase: 'verifying', segmentCount: request.segments.length, percent: 100 });
    return { jobId: request.jobId, path: outputPath, duration: inspection.duration, cached: false, structureFingerprint: request.structureFingerprint, boundaries };
  } catch (error) {
    if (existsSync(outputPath)) rmSync(outputPath, { force: true });
    throw error;
  } finally {
    activePreviewJobs.delete(request.jobId);
    const resolvedRoot = outputRoot.toLowerCase();
    if (workDir.toLowerCase().startsWith(`${resolvedRoot}\\`) || workDir.toLowerCase().startsWith(`${resolvedRoot}/`)) rmSync(workDir, { recursive: true, force: true });
  }
}
