/**
 * 网页截图采集回归测试：
 * 启动 dev server（含 /api/capture/web 中间件），对一个本地测试页采集，
 * 校验 首屏 / 整页长图 / 关键词定位 三种产物。
 *
 * 运行：node scripts/test-web-capture.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-capture-test-'));
const pagePath = path.join(workDir, 'test-page.html');
fs.writeFileSync(
  pagePath,
  `<!doctype html><html><body style="margin:0">
    <h1 style="height:600px">首屏区域</h1>
    <h2 id="kw" style="height:600px">部署指南</h2>
    <p style="height:600px">更多内容</p>
  </body></html>`,
  'utf8',
);

const dev = spawn('cmd.exe', ['/c', 'npm run dev'], { cwd: root, shell: false, stdio: 'ignore', detached: true });

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch('http://localhost:5178');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('dev server 启动超时');
}

let failed = false;
try {
  await waitForServer();
  const response = await fetch('http://localhost:5178/api/capture/web', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `file:///${pagePath.split(path.sep).join('/')}`,
      keywords: ['部署指南', '不存在的关键词'],
      motion: { seconds: 2, fps: 5 },
    }),
  });
  const payload = await response.json();
  console.log('status:', response.status);
  if (payload.error) console.log('server error:', payload.error);
  const assets = payload.assets || [];
  console.log('captured:', assets.map((a) => `${a.name} ${a.width}x${a.height} ${(a.size / 1024).toFixed(0)}KB`).join(', '));

  const hero = assets.find((a) => a.name === 'web-hero.png');
  const fullpage = assets.find((a) => a.name === 'web-fullpage.png');
  const kw = assets.find((a) => a.name.startsWith('web-kw-'));
  if (!hero || hero.width !== 1440 || hero.height !== 900) throw new Error('首屏截图缺失或尺寸错误');
  if (!fullpage || fullpage.height < 1800) throw new Error('整页长图缺失或高度不符: ' + fullpage?.height);
  if (!kw) throw new Error('关键词定位截图缺失');
  if (assets.some((a) => a.name.includes('不存在')) || assets.filter((a) => a.name.startsWith('web-kw')).length !== 1) {
    throw new Error('不存在的关键词不应产出截图');
  }
  const videos = payload.videos || [];
  const motion = videos.find((v) => v.name === 'web-motion.mp4');
  if (!motion || motion.size < 1024 || !motion.dataUrl.startsWith('data:video/mp4;base64,')) {
    throw new Error('连拍录屏 MP4 缺失或无效');
  }
  console.log(`motion: web-motion.mp4 ${(motion.size / 1024).toFixed(0)}KB ${motion.width}x${motion.height}`);
  console.log('WEB CAPTURE TEST OK');
} catch (error) {
  failed = true;
  console.error('FAIL:', error.message);
} finally {
  // Windows 下 cmd 壳会留孤儿 node 进程，必须整棵进程树一起杀
  spawn('taskkill', ['/pid', String(dev.pid), '/T', '/F'], { stdio: 'ignore' });
  fs.rmSync(workDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
