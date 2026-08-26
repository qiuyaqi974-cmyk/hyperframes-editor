import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const source = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!source || !fs.existsSync(source)) {
  console.error('没有找到 HTML 文件。请把导出的 HTML 拖到“HTML转MP4.bat”上。');
  process.exit(1);
}

function browserPath() {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

function writeDataUrlAudio(dataUrl, dir, name) {
  if (!dataUrl?.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = header.split(';')[0];
  const ext = mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'm4a';
  const target = path.join(dir, `${name}.${ext}`);
  fs.writeFileSync(target, header.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body)));
  return target;
}

const executablePath = browserPath();
if (!executablePath) {
  console.error('没有找到 Edge 或 Chrome 浏览器，无法渲染视频。');
  process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperframes-'));
const output = path.join(path.dirname(source), `${path.basename(source, path.extname(source)).replace(/\.render$/, '')}.mp4`);
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.goto(`${pathToFileURL(source).href}?render=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__HF_PROJECT && window.__HF_SEEK, null, { timeout: 15000 });
  const info = await page.evaluate(() => {
    const p = window.__HF_PROJECT;
    const duration = Math.max(6, p.narration?.duration || 0, ...p.scenes.map((s) => s.end), ...p.blocks.map((b) => b.start + b.duration));
    return { width: p.canvas.width, height: p.canvas.height, fps: p.canvas.fps || 30, duration, narration: p.narration?.src || null };
  });
  await page.setViewportSize({ width: info.width, height: info.height });
  // 音轨 = 配音轨（narration）+ 所有 voice 积木（口播生产线生成），按各自入点延迟混流
  const voices = await page.evaluate(() =>
    (window.__HF_PROJECT?.blocks || [])
      .filter((b) => b.type === 'voice' && b.props?.src)
      .map((b) => ({ start: Number(b.start) || 0, src: b.props.src })),
  );
  const audioInputs = [];
  if (info.narration) {
    const p = writeDataUrlAudio(info.narration, tempDir, 'narration');
    if (p) audioInputs.push({ path: p, delayMs: 0 });
  }
  voices.forEach((voice, i) => {
    const p = writeDataUrlAudio(voice.src, tempDir, `voice-${i}`);
    if (p) audioInputs.push({ path: p, delayMs: Math.round(voice.start * 1000) });
  });

  const args = ['-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(info.fps), '-i', 'pipe:0'];
  for (const input of audioInputs) args.push('-i', input.path);
  if (audioInputs.length) {
    const parts = audioInputs.map((input, i) => `[${i + 1}:a]adelay=${input.delayMs}|${input.delayMs}[a${i + 1}]`);
    // 注：内置 ffmpeg 较旧，不支持 amix 的 normalize 选项，使用默认归一化混音
    parts.push(`${audioInputs.map((_, i) => `[a${i + 1}]`).join('')}amix=inputs=${audioInputs.length}[aout]`);
    args.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[aout]');
  }
  args.push('-t', String(info.duration), '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p');
  if (audioInputs.length) args.push('-c:a', 'aac', '-b:a', '192k'); else args.push('-an');
  args.push('-movflags', '+faststart', output);
  const ffmpeg = spawn(ffmpegInstaller.path, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.ceil(info.duration * info.fps);
  console.log(`开始生成：${info.duration.toFixed(1)} 秒，${frames} 帧。`);
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate((time) => window.__HF_SEEK(time), i / info.fps);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await page.locator('#stage').screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, 'drain');
    if (i % Math.max(1, Math.floor(frames / 10)) === 0) console.log(`进度 ${Math.round(i / frames * 100)}%`);
  }
  ffmpeg.stdin.end();
  const [code] = await once(ffmpeg, 'close');
  if (code !== 0) throw new Error(`视频合成失败，错误代码 ${code}`);
  console.log(`完成：${output}`);
} catch (error) {
  console.error(`转换失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
