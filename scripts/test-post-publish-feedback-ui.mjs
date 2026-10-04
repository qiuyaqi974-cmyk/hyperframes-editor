import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.POST_PUBLISH_TEST_URL ?? 'http://127.0.0.1:5199');
  await page.evaluate(async () => {
    const [{ useEditorStore }, { createReleaseCandidate }, { saveReleaseCandidate }] = await Promise.all([
      import('/src/store/editorStore.ts'), import('/src/lib/releaseCandidate.ts'), import('/src/lib/persistence.ts'),
    ]);
    useEditorStore.getState().setProjectName('发布反馈浏览器测试');
    useEditorStore.getState().updateDirector({ objective: '测试不自动改写', audience: '创作者', thesis: '冻结结论' });
    useEditorStore.getState().addBlock('text');
    window.directorBeforeFeedback = JSON.stringify(useEditorStore.getState().director);
    const candidate = createReleaseCandidate(useEditorStore.getState().exportSnapshot(), [], new Date('2026-09-18T00:00:00.000Z'));
    candidate.render = { outputPath: 'D:/final.mp4', reportPath: 'D:/report.json', sha256: 'browser-sha-256', renderedAt: '2026-09-18T01:00:00.000Z' };
    await saveReleaseCandidate(candidate);
  });

  await page.getByRole('button', { name: /AI 助手/ }).click();
  const panel = page.getByLabel('发布后导演反馈');
  await panel.waitFor();
  await panel.getByRole('button', { name: /发布后证据/ }).click();
  await panel.getByLabel('发布数据对应 RC').waitFor();
  await panel.getByLabel('发布平台').fill('B站');
  await panel.getByLabel('发布账号或数据源').fill('账号 A');
  await panel.getByLabel('发布链接或内容 ID').fill('BV-browser-test');
  await panel.getByLabel('播放量').fill('1200');
  await panel.getByLabel('平均观看秒数').fill('2');
  await panel.getByLabel('完播率').fill('25');
  await panel.getByLabel('留存曲线').fill('0:100, 3:55');
  await panel.getByLabel('评论总数').fill('10');
  await panel.getByLabel('质疑评论数').fill('2');
  await panel.getByRole('button', { name: '保存观察并生成待审洞察' }).click();
  await panel.getByText(/独立证据/).waitFor();
  await panel.getByLabel('completion 判断理由').fill('同账号对照后仍偏低，下轮前移论点。');
  await panel.getByRole('checkbox', { name: '我已核对 RC、成片哈希、数据来源和时间窗' }).nth(1).check();
  await panel.getByRole('button', { name: '采纳为下轮参考' }).nth(1).click();
  await panel.getByText(/当前 Brief、冻结方案和 RC 均未修改/).waitFor();

  const persisted = await page.evaluate(async () => {
    const [{ useEditorStore }, { loadPostPublishObservations, loadReleaseCandidates }] = await Promise.all([
      import('/src/store/editorStore.ts'), import('/src/lib/persistence.ts'),
    ]);
    const observations = await loadPostPublishObservations();
    const candidates = await loadReleaseCandidates();
    return {
      directorUnchanged: JSON.stringify(useEditorStore.getState().director) === window.directorBeforeFeedback,
      accepted: observations[0].insights.some((item) => item.id === 'completion' && item.decision === 'accepted'),
      source: observations[0].source,
      windowHours: observations[0].windowHours,
      renderSha: observations[0].renderSha256,
      candidateSha: candidates[0].render.sha256,
    };
  });
  assert.equal(persisted.directorUnchanged, true);
  assert.equal(persisted.accepted, true);
  assert.equal(persisted.source.postUrl, 'BV-browser-test');
  assert(persisted.windowHours > 23 && persisted.windowHours < 25);
  assert.equal(persisted.renderSha, persisted.candidateSha);

  await page.reload();
  await page.getByRole('button', { name: /AI 助手/ }).click();
  const restored = page.getByLabel('发布后导演反馈');
  await restored.waitFor();
  await restored.getByRole('button', { name: /发布后证据/ }).click();
  await restored.getByText('下一轮导演参考（人工采纳）').waitFor();
  assert.deepEqual(errors, []);
  console.log('Post-publish browser checks passed: rendered-RC attribution, manual evidence gate, accepted learning persistence and director/RC isolation.');
} finally { await browser.close(); }
