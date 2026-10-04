import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const scripts = [];
  const errors = [];
  page.on('response', (response) => { if (/\.js(?:\?|$)/.test(response.url())) scripts.push(response.url()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.FRONTEND_CHUNKS_TEST_URL ?? 'http://127.0.0.1:5200');
  await page.getByRole('button', { name: /AI 助手/ }).waitFor();
  assert.equal(scripts.some((url) => /AgentWorkspace|AdvancedAgentTools|exceljs|exportHtml/i.test(url)), false, 'first screen must not fetch optional chunks');

  await page.getByRole('button', { name: /AI 助手/ }).click();
  await page.locator('[aria-label="AI 导演工作台"]').waitFor();
  await page.getByRole('button', { name: /高级工具与实验入口/ }).waitFor();
  assert(scripts.some((url) => /AgentWorkspace/i.test(url)), 'opening AI assistant must fetch workspace chunk');
  assert.equal(scripts.some((url) => /AdvancedAgentTools|exceljs/i.test(url)), false, 'workspace open must not fetch advanced/Excel chunks');

  await page.getByRole('button', { name: /高级工具与实验入口/ }).click();
  await page.getByText('声音与时间轴', { exact: true }).waitFor();
  assert(scripts.some((url) => /AdvancedAgentTools/i.test(url)), 'advanced tools must load after expansion');
  assert.equal(scripts.some((url) => /exceljs/i.test(url)), false, 'expanding advanced tools must not fetch Excel parser');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '渲染 RC' }).click();
  await page.locator('[aria-label="AI 导演工作台"]').waitFor();
  assert.deepEqual(errors, []);
  console.log('Frontend browser checks passed: optional chunks stay off the first screen, then load at their interaction boundaries; RC shortcut still opens the workspace.');
} finally { await browser.close(); }
