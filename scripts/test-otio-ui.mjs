import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

// Run a local Vite server, generate fixtures with test:otio, and point OTIO_CHECK_DIR at them.
const fixtureDir = process.env.OTIO_CHECK_DIR;
assert(fixtureDir, 'Set OTIO_CHECK_DIR to an isolated fixture directory.');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.OTIO_TEST_URL ?? 'http://127.0.0.1:5199');
  await page.getByRole('button', { name: /AI 助手/ }).waitFor();
  const snapshot = JSON.parse(readFileSync(join(fixtureDir, 'ui-snapshot.json'), 'utf8'));
  // Seed only this disposable browser context's documented project persistence store.
  await page.evaluate(async (value) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('hyperframes-editor-v3', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(value, 'autosave');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, snapshot);
  await page.reload();
  await page.getByRole('button', { name: /AI 助手/ }).click();
  const media = page.getByRole('region', { name: '长视频源素材台' });
  if (!(await media.locator('input[accept*=".otio"]').count())) await media.getByRole('button', { name: /长视频源素材台/ }).click();
  const input = media.locator('input[accept*=".otio"]');
  await input.setInputFiles(join(fixtureDir, 'complex.otio'));
  const save = page.getByRole('button', { name: '确认差异并保存派生方案' });
  await save.waitFor();
  assert(await save.isEnabled());
  await save.click();
  await page.getByText('公开时间线（OTIO / FCPXML）', { exact: true }).click();
  const complexPanel = page.locator('div').filter({ has: page.getByRole('button', { name: '重新导出完整 OTIO', exact: true }) });
  assert(await complexPanel.count() > 0);
  assert((await page.locator('body').innerText()).includes('多轨叠加'));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '重新导出完整 OTIO', exact: true }).last().click();
  const download = await downloadPromise;
  const document = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(document.tracks.children.length, 2);
  assert.equal(document.tracks.children[0].children[0].effects[0].time_scalar, 2);
  assert.equal(document.tracks.children[0].children[1].transition_type, 'SMPTE_Dissolve');
  assert.deepEqual(errors, []);
  console.log('OTIO browser smoke passed: import, review save, timeline warnings and full re-export.');
} finally {
  await browser.close();
}
