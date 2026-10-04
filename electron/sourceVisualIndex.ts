import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectSourceMedia } from './sourceMedia';
import { selectVisualIndexSamples, selectVisualRefinementSamples, type SourceVisualIndexResult, type VisualIndexSample } from '../src/lib/sourceVisualIndex';

const version = 'visual-index-v1';

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    child.stderr.on('data', (chunk) => { log = `${log}${String(chunk)}`.slice(-240000); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(log) : reject(new Error(log.slice(-1200) || `画面扫描失败，退出码 ${code}`)));
  });
}

export function detectSourceVisualChanges(sourcePath: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, [
      '-hide_banner', '-loglevel', 'info', '-i', sourcePath,
      '-an', '-vf', 'fps=2,scale=160:-2,select=gt(scene\\,0.18),showinfo',
      '-f', 'null', '-',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const changes: number[] = [];
    let pending = '';
    let tail = '';
    child.stderr.on('data', (chunk) => {
      const lines = `${pending}${String(chunk)}`.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const match = /pts_time:([\d.]+)/.exec(line);
        if (match) changes.push(Number(match[1]));
        tail = `${tail}${line}\n`.slice(-1200);
      }
    });
    child.once('error', reject);
    child.once('close', (code) => {
      const match = /pts_time:([\d.]+)/.exec(pending);
      if (match) changes.push(Number(match[1]));
      code === 0 ? resolve(changes.filter(Number.isFinite)) : reject(new Error(tail || `画面扫描失败，退出码 ${code}`));
    });
  });
}

export async function generateSourceVisualIndex(
  sourcePath: string,
  outputRoot: string,
  maxFrames = 24,
  preferredInterval = 10,
): Promise<SourceVisualIndexResult> {
  const inspection = await inspectSourceMedia(sourcePath);
  selectVisualIndexSamples(inspection.duration, [], maxFrames, preferredInterval);
  const stat = statSync(sourcePath);
  const key = createHash('sha256').update(JSON.stringify([version, sourcePath.toLowerCase(), stat.size, stat.mtimeMs, maxFrames, preferredInterval])).digest('hex');
  const directory = join(outputRoot, key);
  const manifestPath = join(directory, 'index.json');
  mkdirSync(directory, { recursive: true });
  let samples: VisualIndexSample[] | undefined;
  let detectedChanges = 0;
  let cached = false;
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { samples: VisualIndexSample[]; detectedChanges: number };
      if (Array.isArray(manifest.samples) && manifest.samples.length > 0 && manifest.samples.length <= maxFrames
        && manifest.samples.every((sample) => Number.isFinite(sample.time) && sample.time >= 0 && sample.time < inspection.duration)
        && Number.isInteger(manifest.detectedChanges) && manifest.detectedChanges >= 0) {
        samples = manifest.samples;
        detectedChanges = manifest.detectedChanges;
        cached = true;
      }
    } catch { /* Recompute a damaged local cache. */ }
  }
  if (!samples) {
    const changes = await detectSourceVisualChanges(sourcePath);
    detectedChanges = changes.length;
    samples = selectVisualIndexSamples(inspection.duration, changes, maxFrames, preferredInterval);
    writeFileSync(manifestPath, JSON.stringify({ samples, detectedChanges }), 'utf8');
  }
  const frames = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const imagePath = join(directory, `${String(index + 1).padStart(3, '0')}-${sample.time.toFixed(3)}.jpg`);
    if (!existsSync(imagePath)) {
      cached = false;
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(sample.time), '-i', sourcePath,
        '-an', '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', imagePath,
      ]);
    }
    if (!existsSync(imagePath) || statSync(imagePath).size === 0) throw new Error(`无法提取 ${sample.time} 秒的画面。`);
    frames.push({ ...sample, image: `data:image/jpeg;base64,${readFileSync(imagePath).toString('base64')}` });
  }
  const after = statSync(sourcePath);
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('扫描期间原片发生变化，请重新生成。');
  return {
    frames,
    detectedChanges,
    sampledChanges: frames.filter((frame) => frame.reason === 'change').length,
    interval: inspection.duration / frames.length,
    cached,
  };
}

export async function generateSourceVisualRefinement(
  sourcePath: string,
  outputRoot: string,
  start: number,
  end: number,
  maxFrames = 6,
): Promise<SourceVisualIndexResult> {
  const inspection = await inspectSourceMedia(sourcePath);
  if (end > inspection.duration + 0.001) throw new Error('补帧区间超出原片时长。');
  const samples = selectVisualRefinementSamples(start, Math.min(end, inspection.duration), maxFrames);
  const stat = statSync(sourcePath);
  const key = createHash('sha256').update(JSON.stringify(['visual-refinement-v1', sourcePath.toLowerCase(), stat.size, stat.mtimeMs, start, end, maxFrames])).digest('hex');
  const directory = join(outputRoot, 'refinement', key);
  mkdirSync(directory, { recursive: true });
  let cached = true;
  const frames = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const imagePath = join(directory, `${String(index + 1).padStart(3, '0')}-${sample.time.toFixed(3)}.jpg`);
    if (!existsSync(imagePath)) {
      cached = false;
      await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(sample.time), '-i', sourcePath, '-an', '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', imagePath]);
    }
    if (!existsSync(imagePath) || statSync(imagePath).size === 0) throw new Error(`无法提取 ${sample.time} 秒的补充画面。`);
    frames.push({ ...sample, image: `data:image/jpeg;base64,${readFileSync(imagePath).toString('base64')}` });
  }
  const after = statSync(sourcePath);
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('补帧期间原片发生变化，请重新生成。');
  return { frames, detectedChanges: 0, sampledChanges: 0, interval: (end - start) / (maxFrames + 1), cached };
}
