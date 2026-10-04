import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.PLATFORM_ADAPTER_TEST_URL ?? 'http://127.0.0.1:5201');
  const seeded = await page.evaluate(async () => {
    const [{ useEditorStore }, { createReleaseCandidate }, { saveReleaseCandidate }] = await Promise.all([
      import('/src/store/editorStore.ts'), import('/src/lib/releaseCandidate.ts'), import('/src/lib/persistence.ts'),
    ]);
    const store = useEditorStore.getState(); store.setProjectName('平台适配浏览器测试'); store.updateDirector({ objective: '保持当前导演状态' }); store.addBlock('text');
    const director = JSON.stringify(useEditorStore.getState().director);
    const rc = createReleaseCandidate(useEditorStore.getState().exportSnapshot(), [], new Date('2026-09-17T00:00:00.000Z'));
    rc.render = { outputPath: 'final.mp4', reportPath: 'report.json', sha256: 'ui-platform-render-hash', renderedAt: '2026-09-17T01:00:00.000Z' };
    await saveReleaseCandidate(rc);
    window.platformAdapterDirector = director;
    window.platformAdapterRc = JSON.stringify(rc);
    return { rcId: rc.id };
  });

  await page.getByRole('button', { name: /AI 助手/ }).click();
  const feedback = page.getByLabel('发布后导演反馈');
  await feedback.waitFor();
  await feedback.getByRole('button', { name: /发布后证据/ }).click();
  const adapter = feedback.getByLabel('发布数据平台适配器');
  const csv = '\uFEFF作品ID,发布时间,播放量,完播率,平均观看时长,未识别字段\nBV-ui,2026-09-18T08:00:00,"2,500",0.46,9.5,保留在预览但不导入\n';
  await adapter.getByLabel('选择平台导出文件').setInputFiles({ name: 'platform-export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await adapter.getByText(/已读取 1 行、6 列/).waitFor();
  const mappingPreview = adapter.getByLabel('平台字段映射预览');
  await mappingPreview.getByText(/必须人工选择冻结 RC/).waitFor();
  await mappingPreview.getByText(/必须人工填写平台/).waitFor();
  await mappingPreview.getByText(/必须人工填写账号/).waitFor();
  await mappingPreview.getByText(/必须映射观测时间，或手工填写/).waitFor();
  await mappingPreview.getByText(/未识别字段/).waitFor();

  await adapter.getByLabel('平台导出对应 RC').selectOption(seeded.rcId);
  await adapter.getByLabel('平台导出所属平台').fill('B站');
  await adapter.getByLabel('平台导出账号标识').fill('账号 A');
  await adapter.getByLabel('平台导出手工观测时间').fill('2026-09-19T08:00');
  await adapter.getByLabel('完播率 指标单位').selectOption('ratio');
  await mappingPreview.getByText(/时间窗：24 小时/).waitFor();
  await mappingPreview.getByText(/0.46 → 46/).waitFor();
  assert.equal(await adapter.getByRole('button', { name: '按确认映射保存标准观察' }).isDisabled(), true);
  await adapter.getByLabel('确认平台字段映射').check();
  await adapter.getByRole('button', { name: '按确认映射保存标准观察' }).click();
  await adapter.getByText(/已按确认映射转换为标准发布观察/).waitFor();

  const stored = await page.evaluate(async () => {
    const [{ useEditorStore }, persistence] = await Promise.all([import('/src/store/editorStore.ts'), import('/src/lib/persistence.ts')]);
    const observations = await persistence.loadPostPublishObservations();
    const releases = await persistence.loadReleaseCandidates();
    const observation = observations[0];
    return {
      count: observations.length,
      rcId: observation?.rcId,
      renderSha256: observation?.renderSha256,
      platform: observation?.source.platform,
      account: observation?.source.accountLabel,
      contentId: observation?.source.postUrl,
      sourceFile: observation?.source.sourceFileName,
      sourceHashLength: observation?.source.sourceFileSha256?.length,
      mapping: observation?.source.mappingReceipt,
      views: observation?.metrics.views,
      completion: observation?.metrics.completionRate,
      average: observation?.metrics.averageWatchSeconds,
      window: observation?.windowHours,
      directorSame: JSON.stringify(useEditorStore.getState().director) === window.platformAdapterDirector,
      rcSame: JSON.stringify(releases[0]) === window.platformAdapterRc,
    };
  });
  assert.equal(stored.count, 1); assert.equal(stored.rcId, seeded.rcId); assert.equal(stored.renderSha256, 'ui-platform-render-hash');
  assert.equal(stored.platform, 'B站'); assert.equal(stored.account, '账号 A'); assert.equal(stored.contentId, 'BV-ui');
  assert.equal(stored.sourceFile, 'platform-export.csv'); assert.equal(stored.sourceHashLength, 64);
  assert.equal(stored.mapping.rowIndex, 0); assert.deepEqual(stored.mapping.ignoredFields, ['未识别字段']);
  assert(stored.mapping.fields.some((item) => item.targetField === 'completionRate' && item.unit === 'ratio'));
  assert.equal(stored.views, 2500); assert.equal(stored.completion, 46); assert.equal(stored.average, 9.5); assert.equal(stored.window, 24);
  assert.equal(stored.directorSame, true); assert.equal(stored.rcSame, true);

  const batchCsv = '\uFEFF作品ID,发布时间,观测时间,播放量,完播率\nBV-batch-1,2026-09-18T08:00:00+08:00,2026-09-19T08:00:00+08:00,1000,40\nBV-batch-2,2026-09-18T09:00:00+08:00,2026-09-19T09:00:00+08:00,1200,45\n';
  await adapter.getByLabel('选择平台导出文件').setInputFiles({ name: 'batch.csv', mimeType: 'text/csv', buffer: Buffer.from(batchCsv) });
  await adapter.getByText(/已读取 2 行、5 列/).waitFor();
  await adapter.getByLabel('平台导出对应 RC').selectOption(seeded.rcId);
  await adapter.getByLabel('平台导出所属平台').fill('B站');
  await adapter.getByLabel('平台导出账号标识').fill('账号 A');
  await adapter.getByLabel('新映射模板名称').fill('B站五列模板');
  await adapter.getByLabel('确认平台字段映射').check();
  await adapter.getByRole('button', { name: '保存当前确认映射为模板' }).click();
  await adapter.getByText(/已保存人工确认模板/).waitFor();
  await adapter.getByRole('button', { name: '安全批次导入' }).click();
  const batch = adapter.getByLabel('平台安全批次预览');
  await batch.waitFor();
  await batch.getByText(/共 2 行/).waitFor();
  const row2 = batch.getByLabel('批次第 2 行');
  const row3 = batch.getByLabel('批次第 3 行');
  await row2.getByText(/BV-batch-1/).waitFor(); await row3.getByText(/BV-batch-2/).waitFor();
  await row2.getByLabel('第 2 行对应 RC').selectOption(seeded.rcId);
  await row3.getByLabel('第 3 行对应 RC').selectOption(seeded.rcId);
  await row2.getByLabel('确认批次第 2 行').check();
  assert.equal(await batch.getByRole('button', { name: /完整保存 2 行标准观察/ }).isDisabled(), true);
  await row3.getByLabel('确认批次第 3 行').check();
  assert.equal(await batch.getByRole('button', { name: /完整保存 2 行标准观察/ }).isDisabled(), false);
  await batch.getByRole('button', { name: /完整保存 2 行标准观察/ }).click();
  await adapter.getByText(/已完整保存 2 行标准观察/).waitFor();

  const batchStored = await page.evaluate(async () => {
    const [{ useEditorStore }, persistence] = await Promise.all([import('/src/store/editorStore.ts'), import('/src/lib/persistence.ts')]);
    const observations = await persistence.loadPostPublishObservations();
    const batchItems = observations.filter((item) => item.source.sourceFileName === 'batch.csv');
    const sessions = await persistence.loadPostPublishBatchSessions();
    return {
      total: observations.length,
      batchCount: batchItems.length,
      ids: batchItems.map((item) => item.source.postUrl).sort(),
      rows: batchItems.map((item) => item.source.mappingReceipt?.rowIndex).sort(),
      templates: (await persistence.loadPlatformMappingTemplates()).length,
      sessions: sessions.length,
      sessionRows: sessions[0]?.rows.length,
      sessionTemplate: sessions[0]?.template.name,
      sessionFileHash: sessions[0]?.sourceFileSha256,
      directorSame: JSON.stringify(useEditorStore.getState().director) === window.platformAdapterDirector,
      rcSame: JSON.stringify((await persistence.loadReleaseCandidates())[0]) === window.platformAdapterRc,
    };
  });
  assert.equal(batchStored.total, 3); assert.equal(batchStored.batchCount, 2);
  assert.deepEqual(batchStored.ids, ['BV-batch-1', 'BV-batch-2']); assert.deepEqual(batchStored.rows, [0, 1]);
  assert.equal(batchStored.templates, 1); assert.equal(batchStored.sessions, 1); assert.equal(batchStored.sessionRows, 2);
  assert.equal(batchStored.sessionTemplate, 'B站五列模板'); assert.equal(batchStored.sessionFileHash.length, 64);
  assert.equal(batchStored.directorSame, true); assert.equal(batchStored.rcSame, true);

  const sessionsPanel = feedback.getByLabel('发布批次导入会话');
  await sessionsPanel.waitFor();
  await sessionsPanel.getByRole('button', { name: '检查整批回滚影响' }).click();
  const impact = sessionsPanel.getByLabel('批次回滚影响清单');
  await impact.getByText(/删除 2 条观察 · 状态 可整体撤销/).waitFor();
  await impact.getByText(/采纳洞察 0 · 实验 0 · 学习 0 · Brief 0/).waitFor();
  await impact.getByLabel('批次回滚原因').fill('测试中选错导出日期');
  await impact.getByLabel('确认整体撤销批次').check();
  await impact.getByRole('button', { name: '整体撤销 2 条观察' }).click();
  await sessionsPanel.getByText(/已整体撤销 2 条观察/).waitFor();
  const rollbackStored = await page.evaluate(async () => {
    const persistence = await import('/src/lib/persistence.ts');
    const sessions = await persistence.loadPostPublishBatchSessions();
    const rollbacks = await persistence.loadPostPublishBatchRollbacks();
    const observations = await persistence.loadPostPublishObservations();
    return { observations: observations.length, sessions: sessions.length, rollbacks: rollbacks.length, rows: sessions[0]?.rows.length, removed: rollbacks[0]?.observationIds.length, reason: rollbacks[0]?.reason };
  });
  assert.deepEqual(rollbackStored, { observations: 1, sessions: 1, rollbacks: 1, rows: 2, removed: 2, reason: '测试中选错导出日期' });
  assert.deepEqual(errors, []);
  console.log('Platform data adapter browser checks passed: explicit mapping, atomic batch/session save, durable template/row receipts, reviewed all-or-nothing rollback and immutable RC/director state.');
} finally { await browser.close(); }
