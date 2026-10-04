import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const directory = process.env.LINEAGE_CHECK_DIR;
assert(directory, 'Set LINEAGE_CHECK_DIR and run test:story-lineage first.');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.LINEAGE_TEST_URL ?? 'http://127.0.0.1:5199');
  await page.getByRole('button', { name: /AI 助手/ }).waitFor();
  const snapshot = JSON.parse(readFileSync(join(directory, 'snapshot.json'), 'utf8'));
  const rc = JSON.parse(readFileSync(join(directory, 'rc.json'), 'utf8'));
  const evidence = JSON.parse(readFileSync(join(directory, 'evidence.json'), 'utf8'));
  // Test isolation: RC belongs to another named project; current graph must not use its frozen decision.
  rc.snapshot.projectName = '历史工程'; rc.projectName = '历史工程';
  rc.snapshot.storyVersionSelection.rationale = '冻结时的选择理由';
  rc.storyDecision.rationale = '冻结时的选择理由';
  await page.evaluate(async ({ snapshot, rc, evidence }) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('hyperframes-editor-v3', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(snapshot, 'autosave');
        tx.objectStore('projects').put([rc, ...evidence.candidates.filter((item) => item.id !== rc.id)], 'release-candidates');
        tx.objectStore('projects').put(evidence.observations, 'post-publish-feedback');
        tx.objectStore('projects').put(evidence.experiments, 'post-publish-experiments');
        tx.objectStore('projects').put(evidence.learningRecords, 'director-learning-library');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { snapshot, rc, evidence });
  await page.reload();
  await page.getByRole('button', { name: /AI 助手/ }).click();
  const graph = page.locator('details[aria-label="版本血缘图"]');
  await graph.locator('summary').click();
  await graph.getByRole('button', { name: /当前导演胜出：/ }).click();
  assert((await graph.innerText()).includes('节奏更清楚'));
  assert(!(await graph.innerText()).includes('冻结时的选择理由'));
  await graph.getByRole('button', { name: '选中 RC 冻结记录' }).click();
  await graph.getByRole('button', { name: /冻结时导演胜出：/ }).click();
  assert((await graph.innerText()).includes('冻结时的选择理由'));
  assert((await graph.innerText()).includes('历史工程'));
  await graph.getByRole('button', { name: /成片凭证：/ }).first().click();
  assert((await graph.innerText()).includes('D:/output.mp4'));
  await graph.getByRole('button', { name: /B站 发布观察：/ }).first().click();
  assert((await graph.innerText()).includes('export.csv'));
  assert((await graph.innerText()).includes('播放量→views'));
  await graph.getByRole('button', { name: /发布版本实验：/ }).click();
  assert((await graph.innerText()).includes('B 侧描述性指标更高'));
  await graph.getByRole('button', { name: /导演学习记录：/ }).click();
  assert((await graph.innerText()).includes('支持 · 新鲜'));
  await graph.getByRole('button', { name: /已应用到 Brief：/ }).click();
  assert((await graph.innerText()).includes('thesis'));
  await graph.getByRole('button', { name: '当前工程', exact: true }).click();
  assert.equal(await graph.getByRole('button', { name: /冻结时导演胜出：/ }).count(), 0);
  assert.equal(await graph.getByRole('button', { name: /已应用到 Brief：/ }).count(), 1);
  // The actual RC panel must now see the story blockers rather than freezing a stripped snapshot.
  const panel = page.locator('section[aria-label="发布候选版本"]');
  await panel.getByRole('button', { name: /发布候选版本/ }).click();
  assert(await panel.getByRole('button', { name: '冻结为新 RC' }).isDisabled());
  await graph.getByRole('button', { name: '放大查看' }).click();
  assert((await graph.boundingBox()).width > 1000);
  await page.screenshot({ path: join(directory, 'lineage-ui.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Lineage browser checks passed: clickable version/publication graph, frozen/current isolation, import receipts, experiment/learning/Brief links and RC gate.');
} finally { await browser.close(); }
