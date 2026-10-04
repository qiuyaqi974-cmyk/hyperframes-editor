import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { DeliveryPackagePayload } from '../src/lib/exportDeliveryPackage';

function decodeDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('交付包中存在无效的媒体数据。');
  return match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
}

function safeOutputPath(root: string, relativePath: string) {
  const normalized = normalize(relativePath);
  if (isAbsolute(normalized) || normalized.startsWith('..')) {
    throw new Error(`交付文件路径越界：${relativePath}`);
  }
  const output = resolve(root, normalized);
  const relation = relative(resolve(root), output);
  if (relation.startsWith('..') || isAbsolute(relation)) throw new Error(`交付文件路径越界：${relativePath}`);
  return output;
}

export function writeDeliveryPackage(parentDirectory: string, payload: DeliveryPackagePayload) {
  if (!payload.folderName || basename(payload.folderName) !== payload.folderName || payload.folderName === '.') {
    throw new Error('交付包文件夹名称无效。');
  }
  let outputDirectory = join(parentDirectory, payload.folderName);
  let suffix = 2;
  while (true) {
    try {
      mkdirSync(outputDirectory, { recursive: false });
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      outputDirectory = join(parentDirectory, `${payload.folderName}-${suffix++}`);
    }
  }

  for (const file of payload.files) {
    const outputPath = safeOutputPath(outputDirectory, file.relativePath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, decodeDataUrl(file.dataUrl));
  }
  for (const file of payload.externalFiles ?? []) {
    if (!existsSync(file.sourcePath)) throw new Error(`交付原片不存在：${file.sourcePath}`);
    const outputPath = safeOutputPath(outputDirectory, file.relativePath);
    mkdirSync(dirname(outputPath), { recursive: true });
    copyFileSync(file.sourcePath, outputPath);
  }
  writeFileSync(join(outputDirectory, 'manifest.json'), JSON.stringify(payload.manifest, null, 2), 'utf8');
  writeFileSync(join(outputDirectory, 'sceneplan.json'), JSON.stringify(payload.sceneplan, null, 2), 'utf8');
  if (payload.sourceIndex.length) writeFileSync(join(outputDirectory, 'source-index.json'), JSON.stringify(payload.sourceIndex, null, 2), 'utf8');
  if (payload.release) writeFileSync(join(outputDirectory, 'release.json'), JSON.stringify(payload.release, null, 2), 'utf8');
  return outputDirectory;
}
