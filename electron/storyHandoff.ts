import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { WinningStoryHandoffPayload } from '../src/lib/sourceStoryHandoff';
import { inspectSourceMedia } from './sourceMedia';

export interface StoryHandoffVerification {
  version: 1;
  verifiedAt: string;
  fingerprintMode: 'sha256-size-head-tail-1mb';
  status: 'pass';
  sources: Array<{
    id: string; alias: string; name: string; path: string; status: 'pass'; size: number; duration: number;
    width: number; height: number; mtimeMs: number; quickSha256: string;
  }>;
}

function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 80) || 'hyperframes-project';
}

function uniqueDirectory(parent: string, base: string) {
  const root = resolve(parent);
  for (let index = 0; index < 1000; index += 1) {
    const target = resolve(root, index ? `${base}-${index + 1}` : base);
    if (!target.startsWith(`${root}\\`) && target !== root) throw new Error('交接包路径超出目标目录。');
    if (!existsSync(target)) return target;
  }
  throw new Error('目标目录下同名交接包过多，请换一个目录。');
}

function quickFingerprint(path: string, size: number) {
  const sampleSize = Math.min(1024 * 1024, size);
  const head = Buffer.alloc(sampleSize);
  const tail = Buffer.alloc(sampleSize);
  const handle = openSync(path, 'r');
  try {
    readSync(handle, head, 0, sampleSize, 0);
    readSync(handle, tail, 0, sampleSize, Math.max(0, size - sampleSize));
  } finally {
    closeSync(handle);
  }
  return createHash('sha256').update(String(size)).update(head).update(tail).digest('hex');
}

export async function verifyWinningStoryHandoff(payload: WinningStoryHandoffPayload): Promise<StoryHandoffVerification> {
  const verified = [] as StoryHandoffVerification['sources'];
  for (const source of payload.sources) {
    if (!existsSync(source.path)) throw new Error(`原片离线：${source.name}`);
    const stat = statSync(source.path);
    if (!stat.isFile()) throw new Error(`素材路径不是文件：${source.name}`);
    if (stat.size !== source.expectedSize) throw new Error(`素材大小已变化，疑似错版：${source.name}`);
    const inspection = await inspectSourceMedia(source.path);
    if (Math.abs(inspection.duration - source.expectedDuration) > 0.5) throw new Error(`素材时长已变化，疑似错版：${source.name}`);
    const sourceRanges = payload.ranges.filter((range) => range.sourceId === source.id);
    if (sourceRanges.some((range) => range.start < 0 || range.end > inspection.duration + 0.05 || range.end <= range.start)) {
      throw new Error(`素材切点越界：${source.name}`);
    }
    verified.push({
      id: source.id, alias: source.alias, name: source.name, path: source.path, status: 'pass', size: stat.size,
      duration: inspection.duration, width: inspection.width, height: inspection.height, mtimeMs: stat.mtimeMs,
      quickSha256: quickFingerprint(source.path, stat.size),
    });
  }
  return { version: 1, verifiedAt: new Date().toISOString(), fingerprintMode: 'sha256-size-head-tail-1mb', status: 'pass', sources: verified };
}

export async function writeWinningStoryHandoff(parentDirectory: string, payload: WinningStoryHandoffPayload) {
  const verification = await verifyWinningStoryHandoff(payload);
  const outputPath = uniqueDirectory(parentDirectory, `${safeName(payload.projectName)}-胜出方案精剪交接`);
  mkdirSync(outputPath, { recursive: false });
  const writeJson = (name: string, value: unknown) => writeFileSync(join(outputPath, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  writeJson('edl.json', payload.edl);
  if (payload.otio) writeJson('timeline.otio', payload.otio);
  if (payload.fcpxml) writeFileSync(join(outputPath, 'timeline.fcpxml'), payload.fcpxml, 'utf8');
  writeJson('sources.json', { version: 1, sources: payload.sources });
  writeJson('winner.json', { version: 1, projectName: payload.projectName, exportedAt: payload.exportedAt, winner: payload.winner, totalDuration: payload.totalDuration, ranges: payload.ranges });
  writeJson('verification.json', verification);
  writeFileSync(join(outputPath, 'clip-list.csv'), payload.clipListCsv, 'utf8');
  writeFileSync(join(outputPath, 'timeline.srt'), payload.subtitlesSrt, 'utf8');
  writeFileSync(join(outputPath, 'README-剪映交接.md'), payload.readme, 'utf8');
  return { outputPath, fileCount: 7 + (payload.otio ? 1 : 0) + (payload.fcpxml ? 1 : 0), sourceCount: verification.sources.length, verification };
}
