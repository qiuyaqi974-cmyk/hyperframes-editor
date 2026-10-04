import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.POST_PUBLISH_EXPERIMENT_TEST_URL ?? 'http://127.0.0.1:5199');
  await page.evaluate(async () => {
    const [{ useEditorStore }, { createReleaseCandidate }, { createPostPublishObservation }, persistence] = await Promise.all([
      import('/src/store/editorStore.ts'), import('/src/lib/releaseCandidate.ts'), import('/src/lib/postPublishFeedback.ts'), import('/src/lib/persistence.ts'),
    ]);
    const store = useEditorStore.getState();
    store.setProjectName('版本效果浏览器测试'); store.updateDirector({ objective: '解释同一个问题', audience: '创作者', thesis: '同一个核心表达' }); store.addBlock('text');
    window.experimentDirectorBefore = JSON.stringify(useEditorStore.getState().director);
    const left = createReleaseCandidate(store.exportSnapshot(), [], new Date('2026-09-18T00:00:00.000Z'));
    const rightSnapshot = structuredClone(store.exportSnapshot()); rightSnapshot.blocks[0].start = 0.2;
    const right = createReleaseCandidate(rightSnapshot, [left], new Date('2026-09-18T01:00:00.000Z'));
    left.render = { outputPath: 'left.mp4', reportPath: 'left.json', sha256: 'browser-left', renderedAt: '2026-09-18T02:00:00.000Z' };
    right.render = { outputPath: 'right.mp4', reportPath: 'right.json', sha256: 'browser-right', renderedAt: '2026-09-18T02:10:00.000Z' };
    await persistence.saveReleaseCandidate(left); await persistence.saveReleaseCandidate(right);
    const common = { source: { kind: 'manual-entry', platform: 'B站', accountLabel: '账号 A', postUrl: '' }, publishedAt: '2026-09-18T08:00:00.000Z', observedAt: '2026-09-19T08:00:00.000Z' };
    const now = new Date('2026-09-20T00:00:00.000Z');
    const a = createPostPublishObservation({ ...common, rcId: left.id, source: { ...common.source, postUrl: 'BV-left' }, metrics: { views: 1000, completionRate: 30, retention: [{ second: 3, rate: 60 }] } }, [left, right], now);
    const b = createPostPublishObservation({ ...common, rcId: right.id, source: { ...common.source, postUrl: 'BV-right' }, metrics: { views: 1200, completionRate: 40, retention: [{ second: 3, rate: 70 }] } }, [left, right], now);
    await persistence.savePostPublishObservation(a); await persistence.savePostPublishObservation(b);
    window.experimentRcBefore = JSON.stringify(await persistence.loadReleaseCandidates());
  });

  await page.getByRole('button', { name: /AI 助手/ }).click();
  const panel = page.getByLabel('发布实验对照');
  await panel.waitFor();
  await panel.getByRole('button', { name: /发布实验对照/ }).click();
  await panel.getByLabel('对照基线观察').selectOption({ label: 'RC-001 · B站 · 24h' });
  await panel.getByLabel('对照版本观察').selectOption({ label: 'RC-002 · B站 · 24h' });
  await panel.getByText('可比较', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /完播率/);
  assert.match(await panel.innerText(), /\+10%/);
  await panel.getByLabel('人工版本比较结论').fill('对照版本在同平台、账号和 24 小时窗口下描述性指标更高，仍需重复实验。');
  await panel.getByRole('checkbox', { name: /不是因果证明/ }).check();
  await panel.getByRole('button', { name: '保存人工比较结论' }).click();
  await panel.getByText(/没有修改导演 Brief/).waitFor();

  const persisted = await page.evaluate(async () => {
    const [{ useEditorStore }, persistence] = await Promise.all([import('/src/store/editorStore.ts'), import('/src/lib/persistence.ts')]);
    const reviews = await persistence.loadPostPublishExperiments();
    return { count: reviews.length, acknowledged: reviews[0].nonCausalAcknowledged, conclusion: reviews[0].conclusion,
      directorSame: JSON.stringify(useEditorStore.getState().director) === window.experimentDirectorBefore,
      rcSame: JSON.stringify(await persistence.loadReleaseCandidates()) === window.experimentRcBefore };
  });
  assert.equal(persisted.count, 1); assert.equal(persisted.acknowledged, true); assert.match(persisted.conclusion, /重复实验/);
  assert.equal(persisted.directorSame, true); assert.equal(persisted.rcSame, true);

  await page.reload();
  await page.getByRole('button', { name: /AI 助手/ }).click();
  const restored = page.getByLabel('发布实验对照'); await restored.waitFor();
  await restored.getByRole('button', { name: /发布实验对照/ }).click();
  await restored.getByText('已确认的描述性对照').waitFor();
  assert.deepEqual(errors, []);
  console.log('Post-publish experiment browser checks passed: comparability display, descriptive delta, non-causal gate, persistence and director/RC isolation.');
} finally { await browser.close(); }
