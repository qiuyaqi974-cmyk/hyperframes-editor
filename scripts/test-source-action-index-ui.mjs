import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  const errors = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
  await page.goto(process.env.ACTION_INDEX_TEST_URL ?? 'http://127.0.0.1:5199');
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/store/editorStore.ts');
    window.actionChecks = [];
    window.hyperframesElectron = {
      registerSourceMedia: async () => ({ url: '' }),
      getReleaseRenderStatus: async () => ({ available: false }),
      onReleaseRenderProgress: () => () => {}, onReleaseRenderResult: () => () => {},
      onSourceStoryPreviewProgress: () => () => {},
      getSourceTranscriptionCapabilities: async () => ({ available: false, models: [] }),
      getSourceVisualUnderstandingCapabilities: async () => ({ available: false, provider: '', model: '', providers: [] }),
      onSourceProxyProgress: () => () => {}, onSourceTranscriptionProgress: () => () => {},
      onSourceTranscriptionResult: () => () => {}, onSourceTranscriptionError: () => () => {},
      generateSourceVisualCheckpoint: async (path, start, end) => {
        window.actionChecks.push({ path, start, end });
        return { image: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', times: [start, (start + end) / 2, end], windowStart: start, windowEnd: end, cached: false };
      },
    };
    const a = { id: 'a', name: '厨房原片', path: 'D:/kitchen.mp4', duration: 600, width: 1920, height: 1080, size: 12, status: 'original', createdAt: '' };
    useEditorStore.getState().addSourceMedia(a);
    useEditorStore.getState().addSourceMedia({ ...a, id: 'b', name: '花园原片', path: 'D:/garden.mp4', eventMarkers: [{ id: 'old', label: '浇花', start: 12, end: 18, kind: 'action', createdAt: '', visualConfirmed: true }] });
  });
  await page.getByRole('button', { name: /AI 助手/ }).click();
  await page.getByRole('button', { name: /长视频源素材台/ }).click();
  const panel = page.getByRole('region', { name: '视觉动作索引' });
  await panel.waitFor();
  assert.equal(await page.evaluate(() => window.actionChecks.length), 0, 'no eager frame scanning');
  await panel.getByLabel('动作索引主体', { exact: true }).fill('厨师');
  await panel.getByLabel('动作索引动作', { exact: true }).fill('翻炒');
  await panel.getByLabel('动作索引对象', { exact: true }).fill('青菜');
  await panel.getByLabel('动作索引景别').selectOption('detail');
  const save = panel.getByRole('button', { name: '确认并加入动作索引' });
  assert(await save.isDisabled());
  await panel.getByRole('checkbox').check();
  await panel.getByLabel('动作索引结果', { exact: true }).fill('变软');
  assert(await save.isDisabled(), 'editing invalidates confirmation');
  await panel.getByRole('checkbox').check();
  await save.click();
  await panel.getByLabel('搜索视觉动作').fill('厨师 青菜');
  assert.equal(await panel.locator('article').count(), 1);
  await panel.getByRole('button', { name: '检查这条动作' }).click();
  await panel.getByAltText('动作区间入点、中部、出点九帧检查').waitFor();
  assert.deepEqual(await page.evaluate(() => window.actionChecks), [{ path: 'D:/kitchen.mp4', start: 0, end: 5 }]);
  await panel.getByLabel('搜索视觉动作').fill('浇花');
  assert.match(await panel.locator('article').innerText(), /garden.mp4/);
  await panel.getByLabel('筛选景别').selectOption('detail');
  assert.equal(await panel.locator('article').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Action index browser checks passed: manual gate, edit invalidation, cross-source search/filter and demand-only checkpoint request. Media bridge mocked; real checkpoint engine is unchanged.');
} finally { await browser.close(); }
