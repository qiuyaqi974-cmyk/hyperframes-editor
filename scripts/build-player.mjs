/**
 * 构建导出播放器产物：
 *   src/generated/hf-player.iife.js —— 编辑器积木组件 + 播放器的 IIFE 包
 *   src/generated/hf-player.css     —— 播放器所需的 Tailwind CSS
 *
 * exportHtml.ts 通过 ?raw 把这两个文件内联进导出的单文件 HTML，
 * 这样「编辑器画面」和「导出画面」共用同一份渲染实现。
 *
 * 运行：npm run player:build（predev / prebuild 会自动触发）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'src', 'generated');

fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src', 'render', 'player-entry.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  jsx: 'automatic',
  alias: { '@': path.join(root, 'src') },
  // 播放器运行在导出 HTML 里，没有 Vite 注入的 import.meta.env；
  // TTS 地址固定为同源（独立 TTS 服务场景由反向代理提供 /api/tts/*）。
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.VITE_TTS_BASE_URL': '""',
  },
  outfile: path.join(outDir, 'hf-player.iife.js'),
  logLevel: 'info',
});

const cssResult = await postcss([tailwindcss()]).process(
  fs.readFileSync(path.join(root, 'src', 'render', 'player.css'), 'utf8'),
  { from: path.join(root, 'src', 'render', 'player.css') },
);

fs.writeFileSync(path.join(outDir, 'hf-player.css'), cssResult.css);
console.log('player css built');
