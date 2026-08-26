/** 调试：最小 voice/text 工程导出后，在浏览器里抓运行时错误 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wav = (() => {
  const sr = 8000, n = sr * 1.5, pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 12000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return 'data:audio/wav;base64,' + Buffer.concat([h, pcm]).toString('base64');
})();
const anim = { type: 'none', duration: 0, delay: 0, easing: 'linear', direction: 'up', distance: 0, from: 1 };
const snap = {
  app: 'hyperframes-editor', version: 4, themeId: 'midnight', projectName: 't',
  canvas: { width: 960, height: 540, fps: 10, background: '#0e1014' },
  assets: [], narration: null, scenes: [],
  blocks: [
    { id: 't1', type: 'text', name: 'T', position: { x: 100, y: 100 }, start: 0, duration: 4, layer: 0, visible: true, locked: false, animation: anim, props: { text: 'hi', fontSize: 48, color: '#fff', fontWeight: 700, letterSpacing: 0, lineHeight: 1.2, opacity: 1, align: 'left', maxWidth: 600 } },
    { id: 'v1', type: 'voice', name: 'V', position: { x: 100, y: 300 }, start: 1, duration: 1.5, layer: 1, visible: true, locked: false, animation: anim, props: { text: '测试语音', voiceName: 'test', speed: 60, volume: 50, src: wav, duration: 1.5, generated: true, width: 520, height: 164, scale: 1, opacity: 1 } },
  ],
};

const exporterSrc = `
import { writeFileSync } from 'node:fs';
import { generateHyperFramesHtml } from '${path.join(root, 'src', 'lib', 'exportHtml.ts').split(path.sep).join('/')}';
writeFileSync(process.env.HTML_OUT, generateHyperFramesHtml(${JSON.stringify(snap)}), 'utf8');
`;
const exporterOut = path.join(root, 'node_modules', '.cache', 'dbg-export.mjs');
await esbuild.build({
  stdin: { contents: exporterSrc, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node',
  alias: { '@': path.join(root, 'src') },
  outfile: exporterOut, logLevel: 'silent', external: ['exceljs'],
  plugins: [{
    name: 'raw',
    setup(build) {
      build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.join(root, 'src', args.path.slice(2)).split(path.sep).join('/'), namespace: 'raw' }));
      build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
    },
  }],
});

const htmlPath = path.join(os.tmpdir(), 'hf-dbg.html');
process.env.HTML_OUT = htmlPath;
await import(pathToFileURL(exporterOut).href);

const { chromium } = await import('playwright-core');
const candidates = [
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
];
const exe = candidates.find((p) => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
await page.goto(`${pathToFileURL(htmlPath).href}?render=1`, { waitUntil: 'load' });
await page.waitForTimeout(3000);
console.log('hasProject:', await page.evaluate(() => Boolean(window.__HF_PROJECT)));
console.log('hasSeek:', await page.evaluate(() => Boolean(window.__HF_SEEK)));
await browser.close();
