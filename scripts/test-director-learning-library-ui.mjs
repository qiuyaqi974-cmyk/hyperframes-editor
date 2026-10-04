import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.DIRECTOR_LEARNING_TEST_URL ?? 'http://127.0.0.1:5199');
  await page.evaluate(async () => {
    const [{ useEditorStore }, { createReleaseCandidate }, feedback, experiment, persistence] = await Promise.all([
      import('/src/store/editorStore.ts'), import('/src/lib/releaseCandidate.ts'), import('/src/lib/postPublishFeedback.ts'), import('/src/lib/postPublishExperiment.ts'), import('/src/lib/persistence.ts'),
    ]);
    const store = useEditorStore.getState(); store.setProjectName('学习库浏览器测试'); store.updateDirector({ objective: '解释同一个问题', audience: '创作者', thesis: '同一个核心表达' }); store.addBlock('text');
    window.learningDirectorBefore = JSON.stringify(useEditorStore.getState().director);
    const left = createReleaseCandidate(store.exportSnapshot(), [], new Date('2026-09-01T00:00:00.000Z'));
    const rightSnapshot = structuredClone(store.exportSnapshot()); rightSnapshot.blocks[0].start += 0.1;
    const right = createReleaseCandidate(rightSnapshot, [left], new Date('2026-09-01T01:00:00.000Z'));
    left.render = { outputPath: 'a.mp4', reportPath: 'a.json', sha256: 'learn-a', renderedAt: '' };
    right.render = { outputPath: 'b.mp4', reportPath: 'b.json', sha256: 'learn-b', renderedAt: '' };
    await persistence.saveReleaseCandidate(left); await persistence.saveReleaseCandidate(right);
    const common = { source: { kind: 'manual-entry', platform: 'B站', accountLabel: '账号 A', postUrl: '' }, publishedAt: '2026-09-01T08:00:00.000Z', observedAt: '2026-09-02T08:00:00.000Z' };
    let a = feedback.createPostPublishObservation({ ...common, rcId: left.id, source: { ...common.source, postUrl: 'BV-a' }, metrics: { completionRate: 30, retention: [{ second: 3, rate: 55 }] } }, [left, right], new Date('2026-09-03T00:00:00.000Z'));
    const b = feedback.createPostPublishObservation({ ...common, rcId: right.id, source: { ...common.source, postUrl: 'BV-b' }, metrics: { completionRate: 45, retention: [{ second: 3, rate: 70 }] } }, [left, right], new Date('2026-09-03T00:01:00.000Z'));
    a = feedback.decidePostPublishInsight(a, 'completion', 'accepted', '前移核心信息值得测试。', true, new Date('2026-09-03T01:00:00.000Z'));
    await persistence.savePostPublishObservation(a); await persistence.savePostPublishObservation(b);
    const compared = experiment.comparePostPublishObservations(a, b, [left, right], new Date('2026-09-03T02:00:00.000Z'));
    const review = experiment.createPostPublishExperimentReview(compared, '对照版本描述性完播更高，但需要重复。', true, [], new Date('2026-09-03T03:00:00.000Z'));
    await persistence.savePostPublishExperiment(review);
  });

  await page.getByRole('button', { name: /AI 助手/ }).click();
  const panel = page.getByLabel('跨项目导演学习库'); await panel.waitFor();
  await panel.getByRole('button', { name: /跨项目导演学习库/ }).click();
  await panel.getByText(/匹配 2 \/ 2/).waitFor();

  await panel.getByLabel('学习证据角色').selectOption('support');
  await panel.getByLabel('创作假设').fill('核心信息应更早出现');
  await panel.getByLabel('学习分类理由').fill('支持证据，限同账号知识内容。');
  await panel.getByRole('checkbox', { name: /检查来源、适用范围和证据时效/ }).check();
  await panel.getByRole('button', { name: '保存学习分类' }).click();
  await panel.getByText(/不会自动进入任何工程/).waitFor();

  const otherCard = panel.locator('button').filter({ hasText: /下轮应检查中后段节奏/ });
  await otherCard.click();
  await panel.getByLabel('学习证据角色').selectOption('counterexample');
  await panel.getByLabel('创作假设').fill('核心信息应更早出现');
  await panel.getByLabel('学习分类理由').fill('作为反例保留，单条内容不能外推。');
  await panel.getByRole('checkbox', { name: /检查来源、适用范围和证据时效/ }).check();
  await panel.getByRole('button', { name: '保存学习分类' }).click();
  await panel.getByText(/支持 1 · 反例 1/).waitFor();

  await panel.getByLabel('学习库证据角色筛选').selectOption('counterexample');
  await panel.getByText(/匹配 1 \/ 2/).waitFor();
  await panel.getByLabel('搜索导演学习库').fill('中后段 knowledge');
  await panel.getByText(/匹配 1 \/ 2/).waitFor();

  const persisted = await page.evaluate(async () => {
    const [{ useEditorStore }, { loadDirectorLearningRecords }] = await Promise.all([import('/src/store/editorStore.ts'), import('/src/lib/persistence.ts')]);
    const records = await loadDirectorLearningRecords();
    return { count: records.length, roles: records.map((item) => item.curation?.role).sort(), directorSame: JSON.stringify(useEditorStore.getState().director) === window.learningDirectorBefore };
  });
  assert.equal(persisted.count, 2); assert.deepEqual(persisted.roles, ['counterexample', 'support']); assert.equal(persisted.directorSame, true);

  await page.reload(); await page.getByRole('button', { name: /AI 助手/ }).click();
  const restored = page.getByLabel('跨项目导演学习库'); await restored.waitFor(); await restored.getByRole('button', { name: /跨项目导演学习库/ }).click();
  await restored.getByText(/支持 1 · 反例 1/).waitFor();
  assert.deepEqual(errors, []);
  console.log('Director learning library browser checks passed: cross-project sync, scope search, support/counterexample curation, persistence and no automatic director mutation.');
} finally { await browser.close(); }
