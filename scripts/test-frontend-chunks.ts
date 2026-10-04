import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

type ManifestItem = { file: string; isEntry?: boolean; isDynamicEntry?: boolean; imports?: string[]; dynamicImports?: string[] };
const dist = join(process.cwd(), 'dist');
const manifest = JSON.parse(await readFile(join(dist, '.vite', 'manifest.json'), 'utf8')) as Record<string, ManifestItem>;
const entry = Object.entries(manifest).find(([, item]) => item.isEntry);
assert(entry, 'missing frontend entry in Vite manifest');
const [entryKey, entryItem] = entry;
const entrySize = (await stat(join(dist, entryItem.file))).size;
assert(entrySize < 500_000, `initial JavaScript must stay below 500KB, got ${entrySize}`);

const byKey = (text: string) => Object.entries(manifest).find(([key]) => key.toLowerCase().includes(text.toLowerCase()));
const workspace = byKey('AgentWorkspace');
const advanced = byKey('AdvancedAgentTools');
const exportHtml = byKey('exportHtml');
const excel = byKey('exceljs');
for (const [label, item] of [['AI workspace', workspace], ['advanced tools', advanced], ['HTML exporter', exportHtml], ['Excel parser', excel]] as const) {
  assert(item, `${label} must have a separate manifest chunk`);
  assert(item[1].isDynamicEntry, `${label} must load on demand`);
  assert(!entryItem.imports?.includes(item[0]), `${label} must not be an initial static import`);
}
assert(entryItem.dynamicImports?.includes(workspace![0]), 'AI workspace must be reachable as a dynamic entry');
assert(entryItem.dynamicImports?.includes(exportHtml![0]), 'HTML exporter must load only after export is requested');
assert(
  advanced![1].dynamicImports?.includes(excel![0]) || workspace![1].dynamicImports?.includes(excel![0]),
  'Excel parser must load only after a workbook import from the AI workspace or advanced tools',
);
console.log(`Frontend chunk checks passed: initial ${(entrySize / 1024).toFixed(1)}KB; workspace, advanced tools, HTML exporter and Excel parser remain on demand.`);
