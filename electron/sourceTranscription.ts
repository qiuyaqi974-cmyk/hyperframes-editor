import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import type {
  SourceTranscriptionCapabilities,
  SourceTranscriptionFailure,
  SourceTranscriptionProgress,
  SourceTranscriptionResult,
} from '../src/lib/sourceTranscription';

interface StartOptions {
  model: string;
  language: string;
}

interface TranscriptFile {
  segments: SourceTranscriptionResult['segments'];
  meta: SourceTranscriptionResult['meta'];
}

const activeJobs = new Map<string, { child: ReturnType<typeof spawn>; sourceId: string }>();

function parseJsonLine(line: string) {
  try { return JSON.parse(line) as Record<string, unknown>; } catch { return undefined; }
}

function pythonProcess(args: string[]) {
  return spawn('python', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function sourceFingerprint(sourcePath: string) {
  const stat = statSync(sourcePath);
  return createHash('sha256')
    .update(`${sourcePath.toLowerCase()}\0${stat.size}\0${stat.mtimeMs}`)
    .digest('hex');
}

function cachePath(cacheRoot: string, fingerprint: string, options: StartOptions) {
  const key = createHash('sha256').update(`v1\0${fingerprint}\0${options.model}\0${options.language}`).digest('hex');
  return join(cacheRoot, `${key}.json`);
}

export function getSourceTranscriptionCapabilities(helperPath: string): Promise<SourceTranscriptionCapabilities> {
  return new Promise((resolve) => {
    const child = pythonProcess([helperPath, '--check']);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4000); });
    child.on('error', (error) => resolve({ available: false, models: [], error: error.message }));
    child.on('close', () => {
      const message = stdout.split(/\r?\n/).map(parseJsonLine).find((item) => item?.type === 'capabilities');
      if (!message) {
        resolve({ available: false, models: [], error: stderr.trim() || '无法启动本机转写运行库。' });
        return;
      }
      resolve({
        available: Boolean(message.available),
        version: typeof message.version === 'string' ? message.version : undefined,
        python: typeof message.python === 'string' ? message.python : undefined,
        cuda: Boolean(message.cuda),
        deviceName: typeof message.deviceName === 'string' ? message.deviceName : undefined,
        models: Array.isArray(message.models) ? message.models.filter((item): item is string => typeof item === 'string') : [],
        error: typeof message.error === 'string' ? message.error : undefined,
      });
    });
  });
}

export function startSourceTranscription(
  sender: WebContents,
  sourceId: string,
  sourcePath: string,
  options: StartOptions,
  cacheRoot: string,
  helperPath: string,
) {
  if (!existsSync(sourcePath)) throw new Error('原片不存在，无法转写。');
  if ([...activeJobs.values()].some((job) => job.sourceId === sourceId)) throw new Error('这条原片正在转写。');
  mkdirSync(cacheRoot, { recursive: true });
  const fingerprint = sourceFingerprint(sourcePath);
  const outputPath = cachePath(cacheRoot, fingerprint, options);
  const jobId = randomUUID();
  if (existsSync(outputPath)) {
    const cached = JSON.parse(readFileSync(outputPath, 'utf8')) as TranscriptFile;
    return {
      jobId,
      cached: true,
      result: { sourceId, jobId, segments: cached.segments, meta: { ...cached.meta, cached: true } } satisfies SourceTranscriptionResult,
    };
  }

  const generatedAt = new Date().toISOString();
  const child = pythonProcess([
    helperPath,
    '--source', sourcePath,
    '--output', outputPath,
    '--model', options.model,
    '--language', options.language,
    '--fingerprint', fingerprint,
    '--generated-at', generatedAt,
  ]);
  activeJobs.set(jobId, { child, sourceId });
  let stdoutBuffer = '';
  let stderr = '';
  let phase: SourceTranscriptionProgress['phase'] = 'queued';
  const sendProgress = (percent: number, segments?: number) => {
    if (!sender.isDestroyed()) sender.send('source-transcription-progress', { sourceId, jobId, percent, phase, segments } satisfies SourceTranscriptionProgress);
  };
  sendProgress(0);
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const message = parseJsonLine(line);
      if (message?.type === 'status') {
        phase = message.phase === 'transcribing' ? 'transcribing' : 'loading-model';
        sendProgress(phase === 'loading-model' ? 1 : 2);
      } else if (message?.type === 'progress') {
        phase = 'transcribing';
        sendProgress(Number(message.percent) || 0, Number(message.segments) || 0);
      } else if (message?.type === 'error' && typeof message.message === 'string') {
        stderr = message.message;
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}\n${String(chunk)}`.slice(-12000); });
  child.on('error', (error) => {
    activeJobs.delete(jobId);
    if (!sender.isDestroyed()) sender.send('source-transcription-error', { sourceId, jobId, error: error.message } satisfies SourceTranscriptionFailure);
  });
  child.on('close', (code) => {
    const wasActive = activeJobs.delete(jobId);
    if (!wasActive) return;
    if (code === 0 && existsSync(outputPath)) {
      const transcript = JSON.parse(readFileSync(outputPath, 'utf8')) as TranscriptFile;
      if (!sender.isDestroyed()) sender.send('source-transcription-result', {
        sourceId,
        jobId,
        segments: transcript.segments,
        meta: { ...transcript.meta, cached: false },
      } satisfies SourceTranscriptionResult);
      return;
    }
    if (!sender.isDestroyed()) sender.send('source-transcription-error', {
      sourceId,
      jobId,
      error: stderr.trim().slice(-1200) || `本机转写失败，退出码 ${code}`,
    } satisfies SourceTranscriptionFailure);
  });
  return { jobId, cached: false };
}

export function cancelSourceTranscription(jobId: string) {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  activeJobs.delete(jobId);
  job.child.kill();
  return true;
}
