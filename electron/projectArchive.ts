import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import type { ArchiveSourceInspection } from '../src/lib/projectArchive';
import { inspectSourceMedia } from './sourceMedia';

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

export async function inspectArchiveSourceReference(path: string): Promise<ArchiveSourceInspection> {
    if (!existsSync(path)) return { path, status: 'missing' };
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return { path, status: 'missing' };
      const media = await inspectSourceMedia(path);
      return { path, status: 'available', size: stat.size, mtimeMs: stat.mtimeMs, quickSha256: quickFingerprint(path, stat.size), duration: media.duration, width: media.width, height: media.height };
    } catch {
      return { path, status: 'missing' };
    }
}

export function inspectArchiveSourceReferences(paths: string[]): Promise<ArchiveSourceInspection[]> {
  return Promise.all(paths.map(inspectArchiveSourceReference));
}
