import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { WebContents } from 'electron';
import type { SourceMediaInspection } from '../src/lib/sourceMedia';
import { visualCheckpointTimes, type SourceVisualCheckpointResult } from '../src/lib/sourceVisualCheckpoint';

const allowedExtensions = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const activeJobs = new Map<string, ReturnType<typeof spawn>>();

export function isSupportedSource(path: string) {
  return existsSync(path) && allowedExtensions.has(extname(path).toLowerCase());
}

function runProbe(path: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, ['-hide_banner', '-i', path], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-24000); });
    child.on('error', reject);
    child.on('close', () => resolve(stderr));
  });
}

export async function inspectSourceMedia(path: string): Promise<SourceMediaInspection> {
  if (!isSupportedSource(path)) throw new Error(`不支持或找不到素材：${path}`);
  const output = await runProbe(path);
  const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  const videoMatch = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(output);
  if (!durationMatch || !videoMatch) throw new Error(`无法读取视频信息：${basename(path)}`);
  const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  return {
    path,
    name: basename(path),
    duration,
    width: Number(videoMatch[1]),
    height: Number(videoMatch[2]),
    size: statSync(path).size,
  };
}

export async function generateSourceProxy(sender: WebContents, sourceId: string, sourcePath: string, outputRoot: string) {
  if (!isSupportedSource(sourcePath)) throw new Error('源视频不存在或格式不支持。');
  if (activeJobs.has(sourceId)) throw new Error('这条素材正在生成代理。');
  mkdirSync(outputRoot, { recursive: true });
  const key = createHash('sha1').update(sourcePath).digest('hex').slice(0, 10);
  const outputPath = join(outputRoot, `${basename(sourcePath, extname(sourcePath)).replace(/[<>:"/\\|?*]/g, '-')}-${key}-proxy.mp4`);
  if (existsSync(outputPath)) return { proxyPath: outputPath };
  const inspection = await inspectSourceMedia(sourcePath);
  return new Promise<{ proxyPath: string }>((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, [
      '-y', '-i', sourcePath,
      '-vf', "scale='min(960,iw)':-2",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
      '-c:a', 'aac', '-b:a', '96k', '-ar', '48000',
      '-movflags', '+faststart', outputPath,
    ], { windowsHide: true });
    activeJobs.set(sourceId, child);
    let log = '';
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      log = `${log}${text}`.slice(-12000);
      const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
      let current: RegExpExecArray | null = null;
      let found: RegExpExecArray | null = null;
      while ((current = match.exec(text))) found = current;
      if (!found) return;
      const seconds = Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3]);
      if (!sender.isDestroyed()) sender.send('source-proxy-progress', { sourceId, percent: Math.min(99, Math.round(seconds / inspection.duration * 100)) });
    });
    child.on('error', reject);
    child.on('close', (code) => {
      activeJobs.delete(sourceId);
      if (code === 0 && existsSync(outputPath)) resolve({ proxyPath: outputPath });
      else reject(new Error(log.trim().slice(-800) || `代理生成失败，退出码 ${code}`));
    });
  });
}

export function cancelSourceProxy(sourceId: string) {
  const child = activeJobs.get(sourceId);
  if (!child) return false;
  child.kill();
  activeJobs.delete(sourceId);
  return true;
}

/** 抽取单声道低采样率 PCM，再压缩成固定数量的波形峰值；不会读取视频画面。 */
export function generateSourceWaveform(sourcePath: string, bucketCount = 600): Promise<number[]> {
  if (!isSupportedSource(sourcePath)) return Promise.reject(new Error('源视频不存在或格式不支持。'));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, [
      '-hide_banner', '-loglevel', 'error', '-i', sourcePath,
      '-vn', '-ac', '1', '-ar', '100', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let log = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { log = `${log}${String(chunk)}`.slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(log.trim() || `波形提取失败，退出码 ${code}`));
        return;
      }
      const pcm = Buffer.concat(chunks);
      const sampleCount = Math.floor(pcm.length / 2);
      if (!sampleCount) {
        reject(new Error('这条视频没有可读取的音轨。'));
        return;
      }
      const count = Math.max(60, Math.min(bucketCount, sampleCount));
      const stride = sampleCount / count;
      const peaks = Array.from({ length: count }, (_, bucket) => {
        const from = Math.floor(bucket * stride);
        const to = Math.max(from + 1, Math.floor((bucket + 1) * stride));
        let peak = 0;
        for (let index = from; index < to; index += 1) peak = Math.max(peak, Math.abs(pcm.readInt16LE(index * 2)));
        return Number(Math.sqrt(peak / 32768).toFixed(4));
      });
      resolve(peaks);
    });
  });
}

/** 按需生成 3×3 接触表：入点、正文中点、出点各取前/中/后三帧。 */
export async function generateSourceVisualCheckpoint(
  sourcePath: string,
  start: number,
  end: number,
  outputRoot: string,
): Promise<SourceVisualCheckpointResult> {
  if (!isSupportedSource(sourcePath)) throw new Error('源视频不存在或格式不支持。');
  const inspection = await inspectSourceMedia(sourcePath);
  const safeStart = Math.max(0, Math.min(start, inspection.duration));
  const safeEnd = Math.max(safeStart, Math.min(end, inspection.duration));
  const times = visualCheckpointTimes(safeStart, safeEnd, inspection.duration);
  const stat = statSync(sourcePath);
  const key = createHash('sha256').update(`v1\0${sourcePath.toLowerCase()}\0${stat.size}\0${stat.mtimeMs}\0${times.join(',')}`).digest('hex');
  mkdirSync(outputRoot, { recursive: true });
  const outputPath = join(outputRoot, `${key}.jpg`);
  const windowStart = Math.max(0, safeStart - 0.45);
  const windowEnd = Math.min(inspection.duration, safeEnd + 0.45);
  if (existsSync(outputPath)) {
    return { image: `data:image/jpeg;base64,${readFileSync(outputPath).toString('base64')}`, times, windowStart, windowEnd, cached: true };
  }

  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  times.forEach((time) => args.push('-ss', String(time), '-i', sourcePath));
  const scaled = times.map((_, index) => `[${index}:v]scale=240:-2[s${index}]`);
  const rows = [0, 1, 2].map((row) => `[s${row * 3}][s${row * 3 + 1}][s${row * 3 + 2}]hstack=inputs=3[row${row}]`);
  const filter = [...scaled, ...rows, '[row0][row1][row2]vstack=inputs=3[out]'].join(';');
  args.push('-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-q:v', '3', outputPath);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, args, { windowsHide: true });
    let log = '';
    child.stderr.on('data', (chunk) => { log = `${log}${String(chunk)}`.slice(-6000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 && existsSync(outputPath) ? resolve() : reject(new Error(log.trim() || `视觉检查图生成失败，退出码 ${code}`)));
  });
  return { image: `data:image/jpeg;base64,${readFileSync(outputPath).toString('base64')}`, times, windowStart, windowEnd, cached: false };
}
