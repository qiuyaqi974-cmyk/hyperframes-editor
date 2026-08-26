import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

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
}

export interface CapturedImage {
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

export async function captureWeb(request: CaptureRequest): Promise<CapturedImage[]> {
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
  } finally {
    await browser.close();
  }

  if (!results.length) throw new Error('没有采集到任何截图。');
  return results;
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
        const assets = await captureWeb(request);
        json(res, 200, { assets });
      } catch (error) {
        json(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
    })
    .catch((error) => json(res, 400, { error: error instanceof Error ? error.message : String(error) }));
}
