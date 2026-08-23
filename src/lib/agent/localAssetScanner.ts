/*
 * Node/Electron-only entry point. This module is intentionally not imported by
 * the browser editor: a local folder cannot be read from a normal web page.
 */
// @ts-expect-error Node runtime module; this file is executed by Electron/Node, not Vite.
import { readdir, readFile } from 'node:fs/promises';
// @ts-expect-error Node runtime module; this file is executed by Electron/Node, not Vite.
import { join, basename, extname } from 'node:path';
// @ts-expect-error Node runtime module; this file is executed by Electron/Node, not Vite.
import { execFile } from 'node:child_process';
// @ts-expect-error Node runtime module; this file is executed by Electron/Node, not Vite.
import { promisify } from 'node:util';
import type { Asset } from '@/types';

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4']);

function uint32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset);
}

function imageDimensions(data: Uint8Array, extension: string): { width: number; height: number } {
  if (extension === '.png' && data.length >= 24) return { width: uint32(data, 16), height: uint32(data, 20) };
  if (extension === '.webp' && data.length >= 30 && String.fromCharCode(...data.slice(12, 16)) === 'VP8X') {
    return {
      width: 1 + data[24] + (data[25] << 8) + (data[26] << 16),
      height: 1 + data[27] + (data[28] << 8) + (data[29] << 16),
    };
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    for (let offset = 2; offset + 9 < data.length;) {
      if (data[offset] !== 0xff) { offset += 1; continue; }
      const marker = data[offset + 1];
      const length = (data[offset + 2] << 8) + data[offset + 3];
      if (marker >= 0xc0 && marker <= 0xc3) return { width: (data[offset + 7] << 8) + data[offset + 8], height: (data[offset + 5] << 8) + data[offset + 6] };
      if (!length) break;
      offset += 2 + length;
    }
  }
  return { width: 0, height: 0 };
}

async function videoDuration(filePath: string): Promise<number> {
  try {
    const result = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
    const duration = Number.parseFloat(String(result.stdout).trim());
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    // ffprobe is optional; the asset remains importable with an unknown duration.
    return 0;
  }
}

async function scanFolder(folderPath: string): Promise<string[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = join(folderPath, entry.name);
    if (entry.isDirectory()) files.push(...await scanFolder(filePath));
    else files.push(filePath);
  }
  return files;
}

/** 扫描本地商品文件夹，供 Electron/Node 主进程导入 HyperFrames。 */
export async function scanLocalAssets(folderPath: string): Promise<Asset[]> {
  console.log('scan folder:', folderPath);
  const assets: Asset[] = [];
  for (const filePath of await scanFolder(folderPath)) {
    console.log('found file:', filePath);
    const extension = extname(filePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension)) continue;
    const data = await readFile(filePath);
    const isImage = IMAGE_EXTENSIONS.has(extension);
    const dimensions = isImage ? imageDimensions(data, extension) : { width: 0, height: 0 };
    assets.push({
      id: `local_${crypto.randomUUID()}`,
      name: basename(filePath),
      kind: isImage ? 'image' : 'video',
      url: filePath,
      width: dimensions.width,
      height: dimensions.height,
      ...(isImage ? {} : { duration: await videoDuration(filePath) }),
      size: data.byteLength,
    });
  }
  console.log('asset count:', assets.length);
  return assets;
}

export default scanLocalAssets;
