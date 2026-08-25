/**
 * 冒烟测试：验证导出 HTML 的渲染契约。
 * 运行：node scripts/smoke-export.mjs <html 路径> [截图输出路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const source = path.resolve(process.argv[2] || '');
if (!fs.existsSync(source)) {
  console.error('找不到 HTML 文件');
  process.exit(1);
}
const shot = process.argv[3];

function browserPath() {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

const executablePath = browserPath();
if (!executablePath) {
  console.error('未找到 Edge/Chrome');
  process.exit(1);
}

const errors = [];
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  await page.goto(`file:///${source.replace(/\\/g, '/')}?render=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__HF_PROJECT && window.__HF_SEEK, null, { timeout: 15000 });

  // 确定性 seek 到若干时间点并截图（demo 积木从 ~0.2s 起，t=0 时舞台为空是正常的）
  for (const t of [0.5, 2.0, 4.0]) {
    await page.evaluate((time) => window.__HF_SEEK(time), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  const info = await page.evaluate(() => ({
    blocks: document.querySelectorAll('#stage > div').length,
    duration: window.__HF_DURATION,
    renderMode: document.body.classList.contains('render-mode'),
    controlsHidden: (() => {
      const el = document.querySelector('.controls');
      return el ? getComputedStyle(el).display === 'none' : true;
    })(),
  }));
  if (shot) {
    await page.locator('#stage').screenshot({ type: 'png', path: shot });
  }

  console.log(JSON.stringify(info, null, 2));
  if (!info.blocks) throw new Error('舞台上没有渲染出任何积木');
  if (errors.length) throw new Error(`页面报错：\n${errors.join('\n')}`);
  console.log('SMOKE OK');
} finally {
  await browser.close();
}
