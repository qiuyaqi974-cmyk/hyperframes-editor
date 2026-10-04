import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const source = process.argv[2] ? path.resolve(process.argv[2]) : '';
const requestedOutput = process.argv[3] ? path.resolve(process.argv[3]) : '';
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

function localMediaPath(src) {
  if (typeof src !== 'string' || !src) return null;
  try {
    if (src.startsWith('file:')) return fileURLToPath(src);
  } catch {}
  return path.isAbsolute(src) ? src : null;
}

function hasAudioStream(mediaPath) {
  return new Promise((resolve) => {
    const probe = spawn(ffmpegInstaller.path, ['-hide_banner', '-i', mediaPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    probe.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-16000); });
    probe.on('error', () => resolve(false));
    probe.on('close', () => resolve(/Stream #\d+:\d+.*Audio:/i.test(stderr)));
  });
}

const executablePath = browserPath();
if (!executablePath) {
  console.error('没有找到 Edge 或 Chrome 浏览器，无法渲染视频。');
  process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperframes-'));
const output = requestedOutput || path.join(path.dirname(source), `${path.basename(source, path.extname(source)).replace(/\.render$/, '')}.mp4`);
let browser;
let ffmpeg;
let canceled = false;
const cancel = () => {
  canceled = true;
  try { ffmpeg?.stdin?.destroy(); } catch {}
  try { ffmpeg?.kill('SIGTERM'); } catch {}
  void browser?.close().catch(() => undefined);
};
process.once('SIGTERM', cancel);
process.once('SIGINT', cancel);
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
  const sourceClips = await page.evaluate(() =>
    (window.__HF_PROJECT?.blocks || [])
      .filter((b) => b.type === 'video' && b.props?.externalSourceId && b.props?.src && !b.props?.muted)
      .map((b) => ({
        start: Number(b.start) || 0,
        duration: Number(b.duration) || 0,
        sourceIn: Number(b.props.sourceIn) || 0,
        src: b.props.src,
      }))
      .filter((b) => b.duration > 0),
  );
  const audioInputs = [];
  if (info.narration) {
    const p = writeDataUrlAudio(info.narration, tempDir, 'narration');
    if (p) audioInputs.push({ path: p, delayMs: 0, kind: 'full' });
  }
  voices.forEach((voice, i) => {
    const p = writeDataUrlAudio(voice.src, tempDir, `voice-${i}`);
    if (p) audioInputs.push({ path: p, delayMs: Math.round(voice.start * 1000), kind: 'full' });
  });
  for (const clip of sourceClips) {
    const mediaPath = localMediaPath(clip.src);
    if (!mediaPath || !fs.existsSync(mediaPath) || !await hasAudioStream(mediaPath)) continue;
    audioInputs.push({
      path: mediaPath,
      delayMs: Math.round(clip.start * 1000),
      kind: 'clip',
      sourceIn: clip.sourceIn,
      duration: clip.duration,
    });
  }

  const args = ['-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(info.fps), '-i', 'pipe:0'];
  const uniqueAudioPaths = [...new Set(audioInputs.map((input) => input.path))];
  for (const inputPath of uniqueAudioPaths) args.push('-i', inputPath);
  if (audioInputs.length) {
    const parts = [];
    const sourceLabels = new Map();
    uniqueAudioPaths.forEach((inputPath, pathIndex) => {
      const users = audioInputs.map((input, index) => ({ input, index })).filter((item) => item.input.path === inputPath);
      if (users.length === 1) {
        sourceLabels.set(users[0].index, `[${pathIndex + 1}:a]`);
        return;
      }
      const labels = users.map((item) => `[src${item.index}]`).join('');
      parts.push(`[${pathIndex + 1}:a]asplit=${users.length}${labels}`);
      users.forEach((item) => sourceLabels.set(item.index, `[src${item.index}]`));
    });
    audioInputs.forEach((input, i) => {
      const delay = `adelay=${input.delayMs}|${input.delayMs}`;
      const sourceLabel = sourceLabels.get(i);
      if (input.kind !== 'clip') {
        parts.push(`${sourceLabel}${delay}[a${i + 1}]`);
        return;
      }
      const fade = Math.min(0.03, input.duration / 2);
      const fadeOut = Math.max(0, input.duration - fade);
      parts.push(`${sourceLabel}atrim=start=${input.sourceIn}:duration=${input.duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOut}:d=${fade},${delay}[a${i + 1}]`);
    });
    // 注：内置 ffmpeg 较旧，不支持 amix 的 normalize 选项，使用默认归一化混音
    parts.push(`${audioInputs.map((_, i) => `[a${i + 1}]`).join('')}amix=inputs=${audioInputs.length}[aout]`);
    const filterScript = path.join(tempDir, 'audio-filter.txt');
    fs.writeFileSync(filterScript, parts.join(';'));
    args.push('-filter_complex_script', filterScript, '-map', '0:v', '-map', '[aout]');
  }
  args.push('-t', String(info.duration), '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p');
  if (audioInputs.length) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000'); else args.push('-an');
  args.push('-movflags', '+faststart', output);
  ffmpeg = spawn(ffmpegInstaller.path, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.ceil(info.duration * info.fps);
  console.log(`开始生成：${info.duration.toFixed(1)} 秒，${frames} 帧。`);
  for (let i = 0; i < frames; i += 1) {
    if (canceled) throw new Error('渲染已取消');
    await page.evaluate((time) => window.__HF_SEEK(time), i / info.fps);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await page.locator('#stage').screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, 'drain');
    if (i % Math.max(1, Math.floor(frames / 100)) === 0 || i === frames - 1) {
      const percent = Math.min(99, Math.round((i + 1) / frames * 100));
      console.log(`HF_PROGRESS:${percent}:${i + 1}:${frames}`);
    }
  }
  ffmpeg.stdin.end();
  const [code] = await once(ffmpeg, 'close');
  if (canceled) throw new Error('渲染已取消');
  if (code !== 0) throw new Error(`视频合成失败，错误代码 ${code}`);
  console.log(`HF_PROGRESS:100:${frames}:${frames}`);
  console.log(`完成：${output}`);
} catch (error) {
  console.error(`转换失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = canceled ? 130 : 1;
} finally {
  await browser?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
