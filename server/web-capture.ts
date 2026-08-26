import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

/**
 * 网页截图采集服务（移植自 Remotion 生产线的 capture-*.mjs）。
 *
 * 给一个网址，产出视频素材库可直接使用的 PNG：
 * - 首屏截图
 * - 整页长图（超长页面截断到 8000px）
 * - 关键词定位截图（滚动到包含该文字的标题/段落再截，采集网页特定段落）
 *
 * 与 Remotion 版的差异：参数化（不再硬编码网址与滚动文字），
 * 浏览器用项目已有的 playwright-core（Edge/Chrome 自动探测）。
 */

export interface CaptureRequest {
  url: string;
  /** 关键词列表：滚动到包含该文字的元素居中后截图 */
  keywords?: string[];
  /** 首屏视口宽高，默认 1440×900 */
  viewportWidth?: number;
  viewportHeight?: number;
  /** deviceScaleFactor，默认 1.5（保证截图清晰度） */
  deviceScaleFactor?: number;
  /** 连拍录屏：对当前页面（可先用 keyword 定位）连续截帧合成 MP4 */
  motion?: {
    /** 录制秒数，1-15，默认 4 */
    seconds?: number;
    /** 帧率，2-15，默认 10（与 Remotion 生产线的连拍参数同量级） */
    fps?: number;
    /** 录制前先滚动到该关键词位置（如在线 Demo 区域） */
    keyword?: string;
  };
}

export interface CapturedImage {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  size: number;
}

export interface CapturedVideo {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  size: number;
}

const MAX_FULLPAGE_HEIGHT = 8000;
const NAV_TIMEOUT = 60_000;

export function findBrowserPath(): string | null {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > 1_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: any, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/** 连拍帧 → MP4（yuv420p 需要偶数宽高） */
function encodeFramesToMp4(framesDir: string, fps: number, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const outPath = path.join(framesDir, '..', 'motion.mp4');
    const ffmpeg = spawn(ffmpegInstaller.path, [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(framesDir, 'frame-%03d.jpg'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast',
      '-movflags', '+faststart',
      outPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => { stderr += chunk; });
    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) resolve(fs.readFileSync(outPath));
      else reject(new Error(`连拍合成 MP4 失败（code ${code}）：${stderr.slice(-400)}`));
    });
    ffmpeg.on('error', reject);
    void count;
  });
}

/** 录屏：连拍 JPEG 帧再合成 MP4（deviceScaleFactor 固定 1，控制体积） */
async function recordMotion(
  page: any,
  motion: NonNullable<CaptureRequest['motion']>,
  width: number,
  height: number,
): Promise<CapturedVideo | null> {
  const seconds = Math.min(15, Math.max(1, Number(motion.seconds) || 4));
  const fps = Math.min(15, Math.max(2, Number(motion.fps) || 10));
  const intervalMs = Math.round(1000 / fps);
  const totalFrames = seconds * fps;

  if (motion.keyword) {
    await page.evaluate((needle: string) => {
      const elements = [...document.querySelectorAll('h1,h2,h3,p,span,strong,li,video,canvas')];
      const target = elements.find((element) => element.textContent?.trim().includes(needle));
      target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, motion.keyword);
    await page.waitForTimeout(600);
  }

  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-motion-'));
  try {
    for (let i = 0; i < totalFrames; i += 1) {
      const frame = await page.screenshot({
        type: 'jpeg',
        quality: 88,
        path: path.join(framesDir, `frame-${String(i).padStart(3, '0')}.jpg`),
      });
      void frame;
      await page.waitForTimeout(intervalMs);
    }
    const mp4 = await encodeFramesToMp4(framesDir, fps, totalFrames);
    return {
      name: 'web-motion.mp4',
      dataUrl: `data:video/mp4;base64,${mp4.toString('base64')}`,
      width,
      height,
      size: mp4.length,
    };
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

export async function captureWeb(
  request: CaptureRequest,
): Promise<{ assets: CapturedImage[]; videos: CapturedVideo[] }> {
  const url = String(request.url || '').trim();
  if (!/^(https?:\/\/|file:\/\/)/i.test(url)) {
    throw new Error('url 必须是 http(s) 或 file 地址');
  }
  const executablePath = findBrowserPath();
  if (!executablePath) throw new Error('未找到 Edge 或 Chrome，无法采集网页。');

  const width = Math.min(2560, Math.max(640, Number(request.viewportWidth) || 1440));
  const height = Math.min(1600, Math.max(480, Number(request.viewportHeight) || 900));
  const scale = Math.min(3, Math.max(1, Number(request.deviceScaleFactor) || 1.5));
  const keywords = (Array.isArray(request.keywords) ? request.keywords : [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .slice(0, 8);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb'],
  });

  const results: CapturedImage[] = [];
  const videos: CapturedVideo[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT }).catch(async () => {
      // 部分 SPA 不会 idle，退化为 load 事件
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });
    });
    await page.waitForTimeout(1500);
    await page.addStyleTag({
      content: `
        [role="dialog"], .js-notice, .flash, cookie-consent, .cookie-consent { display: none !important; }
        * { caret-color: transparent !important; }
      `,
    });

    const takeShot = async (name: string) => {
      const buffer = await page.screenshot({ type: 'png' });
      results.push({
        name,
        dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        width,
        height,
        size: buffer.length,
      });
    };

    await takeShot('web-hero.png');

    // 整页长图：clip 可超出视口，超长页面截断
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const longHeight = Math.min(pageHeight, MAX_FULLPAGE_HEIGHT);
    if (longHeight > height) {
      const buffer = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height: longHeight },
      });
      results.push({
        name: 'web-fullpage.png',
        dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        width,
        height: longHeight,
        size: buffer.length,
      });
    }

    // 关键词定位：滚动到包含该文字的元素居中后截图
    for (let i = 0; i < keywords.length; i += 1) {
      const keyword = keywords[i];
      const found = await page.evaluate((needle) => {
        const elements = [...document.querySelectorAll('h1,h2,h3,p,span,strong,li')];
        const target = elements.find((element) => element.textContent?.trim().includes(needle));
        target?.scrollIntoView({ block: 'center', behavior: 'instant' });
        return Boolean(target);
      }, keyword);
      if (!found) continue;
      await page.waitForTimeout(600);
      await takeShot(`web-kw-${i + 1}.png`);
    }

    // 连拍录屏：网页里的动态演示（在线 Demo、动画）变成 MP4 素材
    if (request.motion) {
      const video = await recordMotion(page, request.motion, width, height);
      if (video) videos.push(video);
    }
  } finally {
    await browser.close();
  }

  if (!results.length && !videos.length) throw new Error('没有采集到任何素材。');
  return { assets: results, videos };
}

/** connect 风格 handler：POST /api/capture/web */
export function webCaptureHandler(req: any, res: any, next: () => void) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    json(res, 405, { error: '仅支持 POST 请求。' });
    return;
  }
  readBody(req)
    .then(async (raw) => {
      let request: CaptureRequest;
      try {
        request = JSON.parse(raw) as CaptureRequest;
      } catch {
        json(res, 400, { error: '请求体必须是 JSON。' });
        return;
      }
      try {
        const { assets, videos } = await captureWeb(request);
        json(res, 200, { assets, videos });
      } catch (error) {
        json(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
    })
    .catch((error) => json(res, 400, { error: error instanceof Error ? error.message : String(error) }));
}
