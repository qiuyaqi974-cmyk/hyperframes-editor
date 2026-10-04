import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.LEARNING_BRIEF_TEST_URL ?? 'http://127.0.0.1:5202');
  await page.evaluate(async () => {
    const [{ useEditorStore }, release, feedback, library, persistence] = await Promise.all([
      import('/src/store/editorStore.ts'), import('/src/lib/releaseCandidate.ts'), import('/src/lib/postPublishFeedback.ts'), import('/src/lib/directorLearningLibrary.ts'), import('/src/lib/persistence.ts'),
    ]);
    const store = useEditorStore.getState();
    store.setProjectName('学习引用浏览器测试');
    store.updateDirector({ audience: '原受众', thesis: '原核心表达', contentType: 'story' });
    const rc = release.createReleaseCandidate(store.exportSnapshot(), [], new Date());
    rc.render = { outputPath: 'learning.mp4', reportPath: 'learning.json', sha256: 'learning-ui-hash', renderedAt: new Date().toISOString() };
    await persistence.saveReleaseCandidate(rc);
    let observation = feedback.createPostPublishObservation({ rcId: rc.id, source: { kind: 'manual-entry', platform: 'B站', accountLabel: '账号A', postUrl: 'BV-learning-ui' }, publishedAt: '2026-09-18T00:00:00.000Z', observedAt: '2026-09-19T00:00:00.000Z', metrics: { completionRate: 48, retention: [] } }, [rc], new Date());
    observation = feedback.decidePostPublishInsight(observation, 'completion', 'accepted', '人工确认可用于测试。', true, new Date());
    await persistence.savePostPublishObservation(observation);
    const base = library.synchronizeDirectorLearningRecords([observation], [], [rc], [], new Date())[0];
    const support = library.curateDirectorLearningRecord(base, 'support', '核心内容应在前段出现', '仅适用于同平台知识表达。', true, new Date());
    support.scope.contentTypes = ['knowledge']; support.scope.audiences = ['创作者']; support.summary = '支持前移核心内容';
    const counter = library.curateDirectorLearningRecord({ ...structuredClone(base), id: `${base.id}:counter`, summary: '反例提示发布时间可能干扰' }, 'counterexample', '核心内容应在前段出现', '发布时间不同，不能当作因果结论。', true, new Date());
    counter.scope.contentTypes = ['knowledge']; counter.scope.audiences = ['创作者'];
    await persistence.saveDirectorLearningRecords([support, counter]);
    window.learningBriefOriginal = JSON.stringify(useEditorStore.getState().director);
  });

  await page.getByRole('button', { name: /AI 助手/ }).click();
  const panel = page.getByLabel('跨项目导演学习库');
  await panel.waitFor();
  await panel.getByRole('button', { name: /跨项目导演学习库/ }).click();
  await panel.getByLabel('引用证据 支持前移核心内容').check();
  await panel.getByRole('button', { name: '生成 Brief 建议' }).click();
  await panel.getByText(/同一假设存在未纳入的反例/).waitFor();

  await panel.getByLabel('引用证据 反例提示发布时间可能干扰').check();
  await panel.getByRole('button', { name: '生成 Brief 建议' }).click();
  const proposal = panel.getByLabel('学习证据 Brief 建议');
  await proposal.getByText(/支持 · 新鲜/).waitFor();
  await proposal.getByText(/反例 · 新鲜/).waitFor();
  await proposal.getByText(/RC .*SHA-256 learning-ui-hash/).first().waitFor();
  await proposal.getByLabel('确认更新 核心表达').check();
  await proposal.getByLabel('核心表达建议值').fill('经证据审查后的核心表达');
  await proposal.getByLabel('证据适用理由').fill('同平台、同受众；保留发布时间这一反例边界。');
  await proposal.getByLabel('确认检查学习引用').check();
  await proposal.getByRole('button', { name: '应用已确认字段' }).click();
  await panel.getByText(/可撤销的导演更新/).waitFor();

  const applied = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/store/editorStore.ts');
    const director = useEditorStore.getState().director;
    return { thesis: director.thesis, audience: director.audience, contentType: director.contentType, applications: director.learningApplications };
  });
  assert.equal(applied.thesis, '经证据审查后的核心表达');
  assert.equal(applied.audience, '原受众'); assert.equal(applied.contentType, 'story');
  assert.equal(applied.applications.length, 1); assert.equal(applied.applications[0].citations.length, 2);
  assert(applied.applications[0].citations.some((item) => item.role === 'counterexample' && item.provenance.renderSha256[0] === 'learning-ui-hash'));

  const undone = await page.evaluate(async () => {
    const { editorHistory, useEditorStore } = await import('/src/store/editorStore.ts');
    editorHistory.undo();
    const director = useEditorStore.getState().director;
    return { thesis: director.thesis, applications: director.learningApplications?.length ?? 0 };
  });
  assert.deepEqual(undone, { thesis: '原核心表达', applications: 0 });
  assert.deepEqual(errors, []);
  console.log('Learning Brief browser checks passed: explicit evidence selection, counterexample gate, full credentials, field-by-field apply, immutable citation receipt and one-step undo.');
} finally { await browser.close(); }
