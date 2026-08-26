/**
 * MP4 音频混流回归测试：
 * 1. 生成一段 WAV（data URL）作为 voice 积木音频
 * 2. 构造最小工程 → 导出 HTML（共享播放器）
 * 3. 跑 tools/html-to-mp4.mjs 渲染 MP4
 * 4. 用 ffmpeg -i 检查产物包含音频流
 *
 * 运行：node scripts/run-mp4-audio-test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import esbuild from 'esbuild';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-audio-test-'));

/* 1. 生成 1.5s / 8kHz / 正弦 WAV data URL */
const sampleRate = 8000;
const seconds = 1.5;
const pcm = Buffer.alloc(sampleRate * seconds * 2);
for (let i = 0; i < sampleRate * seconds; i += 1) {
  pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), i * 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
const wavDataUrl = `data:audio/wav;base64,${Buffer.concat([header, pcm]).toString('base64')}`;

/* 2. 最小工程：一个 voice 块（1s 入点）+ 一个 text 块 */
const animation = { type: 'none', duration: 0, delay: 0, easing: 'linear', direction: 'up', distance: 0, from: 1 };
const snapshot = {
  app: 'hyperframes-editor',
  version: 4,
  themeId: 'midnight',
  projectName: 'audio-mix-test',
  canvas: { width: 960, height: 540, fps: 10, background: '#0e1014' },
  assets: [],
  narration: null,
  scenes: [],
  blocks: [
    {
      id: 'txt1', type: 'text', name: '标题', position: { x: 200, y: 200 },
      start: 0, duration: 4, layer: 0, visible: true, locked: false, animation,
      props: { text: '音频混流测试', fontSize: 64, color: '#fff', fontWeight: 700, letterSpacing: 0, lineHeight: 1.2, opacity: 1, align: 'left', maxWidth: 800 },
    },
    {
      id: 'voi1', type: 'voice', name: '配音 1', position: { x: 200, y: 380 },
      start: 1, duration: 1.5, layer: 1, visible: true, locked: false, animation,
      props: { text: '测试语音', voiceName: 'test', speed: 60, volume: 50, src: wavDataUrl, duration: 1.5, generated: true, width: 520, height: 164, scale: 1, opacity: 1 },
    },
  ],
};

/* 3. 用共享 exportHtml 生成 HTML（esbuild 提供 ?raw 语义） */
const exporterSrc = `
import { writeFileSync } from 'node:fs';
import { generateHyperFramesHtml } from '${path.join(root, 'src', 'lib', 'exportHtml.ts').split(path.sep).join('/')}';
const snapshot = ${JSON.stringify(snapshot)};
writeFileSync(process.env.HTML_OUT, generateHyperFramesHtml(snapshot), 'utf8');
console.log('html written');
`;
const exporterOut = path.join(root, 'node_modules', '.cache', 'mp4-audio-export.mjs');
await esbuild.build({
  stdin: { contents: exporterSrc, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node',
  alias: { '@': path.join(root, 'src') },
  outfile: exporterOut, logLevel: 'silent',
  external: ['exceljs'],
  plugins: [{
    name: 'raw',
    setup(build) {
      build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.join(root, 'src', args.path.slice(2)).split(path.sep).join('/'), namespace: 'raw' }));
      build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
    },
  }],
});

const htmlPath = path.join(workDir, 'audio-test.render.html');
process.env.HTML_OUT = htmlPath;
await import(pathToFileURL(exporterOut).href);

/* 4. 渲染 MP4 */
const mp4Path = path.join(workDir, 'audio-test.mp4');
const render = spawnSync(process.execPath, [path.join(root, 'tools', 'html-to-mp4.mjs'), htmlPath], {
  encoding: 'utf8', timeout: 180000,
});
console.log(render.stdout);
if (render.status !== 0 || !fs.existsSync(mp4Path)) {
  console.error(render.stderr);
  throw new Error('MP4 渲染失败');
}

/* 5. 检查音频流 */
const probe = spawnSync(ffmpegInstaller.path, ['-i', mp4Path, '-f', 'null', '-'], { encoding: 'utf8' });
const output = probe.stderr || '';
const hasAudio = output.includes('Audio:');
const hasVideo = output.includes('Video:');
console.log(`video: ${hasVideo}, audio: ${hasAudio}`);
if (!hasAudio) throw new Error('产物缺少音频流');
if (!output.includes('44100 Hz') && !output.includes('48000 Hz')) {
  console.warn('警告：音频采样率异常');
}
console.log('MP4 AUDIO MIX TEST OK');
fs.rmSync(workDir, { recursive: true, force: true });
