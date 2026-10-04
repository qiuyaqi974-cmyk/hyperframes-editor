import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.PROJECT_ARCHIVE_TEST_URL ?? 'http://127.0.0.1:5200');
  const archiveText = await page.evaluate(async () => {
    const [{ useEditorStore }, release, feedback, persistence, archive] = await Promise.all([
      import('/src/store/editorStore.ts'), import('/src/lib/releaseCandidate.ts'), import('/src/lib/postPublishFeedback.ts'), import('/src/lib/persistence.ts'), import('/src/lib/projectArchive.ts'),
    ]);
    const store = useEditorStore.getState();
    store.setProjectName('浏览器归档工程'); store.addBlock('text');
    store.addSourceMedia({ id: 'archive-source', name: 'long-source.mp4', path: 'D:\\offline\\long-source.mp4', duration: 3600, width: 1920, height: 1080, size: 987654321, status: 'missing', createdAt: '2026-09-01T00:00:00.000Z' });
    const project = useEditorStore.getState().exportSnapshot();
    const rc = release.createReleaseCandidate(project, [], new Date('2026-09-10T00:00:00.000Z'));
    rc.render = { outputPath: 'final.mp4', reportPath: 'final.json', sha256: 'archive-render-hash', renderedAt: '2026-09-10T01:00:00.000Z' };
    await persistence.saveReleaseCandidate(rc);
    let observation = feedback.createPostPublishObservation({ rcId: rc.id, source: { kind: 'manual-entry', platform: 'B站', accountLabel: '账号', postUrl: 'BV-archive-ui' }, publishedAt: '2026-09-11T00:00:00.000Z', observedAt: '2026-09-12T00:00:00.000Z', metrics: { completionRate: 40, retention: [] } }, [rc], new Date('2026-09-12T01:00:00.000Z'));
    observation = feedback.decidePostPublishInsight(observation, 'completion', 'accepted', '人工确认归档测试。', true, new Date('2026-09-12T02:00:00.000Z'));
    await persistence.savePostPublishObservation(observation);
    const confirmedAt = '2026-09-12T03:00:00.000Z';
    const template = { id: 'archive-ui-template', name: '归档 UI 模板', createdAt: confirmedAt, updatedAt: confirmedAt, format: 'csv', headers: ['内容ID'], mappings: [{ sourceField: '内容ID', targetField: 'contentId', unit: 'text' }], platform: 'B站', accountLabel: '账号' };
    const batchObservation = {
      ...structuredClone(observation), id: 'archive-ui-batch-observation', insights: observation.insights.map((item) => ({ ...item, decision: 'pending', decisionReason: undefined, decidedAt: undefined })),
      source: { kind: 'platform-export', platform: 'B站', accountLabel: '账号', postUrl: 'BV-archive-batch', sourceFileName: 'archive.csv', sourceFileSha256: 'archive-ui-file-sha256', recordedAt: confirmedAt, mappingReceipt: { rowIndex: 2, fields: template.mappings, ignoredFields: [], confirmedAt } },
    };
    await persistence.savePostPublishObservationBatchSession([batchObservation], { sourceFileName: 'archive.csv', sourceFileSha256: 'archive-ui-file-sha256', format: 'csv', template, confirmedAt }, new Date('2026-09-12T04:00:00.000Z'));
    const storedObservations = await persistence.loadPostPublishObservations();
    const batchSessions = await persistence.loadPostPublishBatchSessions();
    const batchRollbacks = await persistence.loadPostPublishBatchRollbacks();
    const bundle = await archive.createProjectArchive({ project, releaseCandidates: [rc], postPublishObservations: storedObservations, postPublishExperiments: [], directorLearning: [], postPublishBatchSessions: batchSessions, postPublishBatchRollbacks: batchRollbacks }, [{ path: 'D:\\offline\\long-source.mp4', status: 'available', size: 987654321, mtimeMs: 123, quickSha256: 'archive-source-quick-hash', duration: 3600, width: 1920, height: 1080 }], new Date('2026-09-20T00:00:00.000Z'));
    store.setProjectName('当前安全工程');
    return JSON.stringify(bundle);
  });

  await page.getByRole('button', { name: /AI 助手/ }).click();
  const panel = page.getByLabel('工程归档与可移植恢复包');
  await panel.waitFor();
  await panel.getByRole('button', { name: '工程归档与可移植恢复包' }).click();

  assert.equal(await panel.getByRole('button', { name: '导出已预览归档' }).count(), 0);
  await panel.getByRole('button', { name: '预览归档内容' }).click();
  const disclosurePreview = panel.getByLabel('归档内容与依赖预览');
  await disclosurePreview.getByText(/最小披露/).waitFor();
  await disclosurePreview.getByText(/RC 0 · 发布观察 0 · 实验 0 · 学习 0 · 批次 0 · 回滚 0/).waitFor();
  assert.equal(await disclosurePreview.getByRole('button', { name: '导出已预览归档' }).isDisabled(), false);
  const scope = panel.getByLabel('归档披露范围');
  await scope.getByLabel('发布观察与实验').check();
  await scope.getByLabel('跨项目导演学习').check();
  await scope.getByLabel('批次会话与回滚回执').check();
  assert.equal(await panel.getByLabel('归档内容与依赖预览').count(), 0, 'changing scope invalidates stale preview');
  await panel.getByRole('button', { name: '预览归档内容' }).click();
  await disclosurePreview.getByText(/全量披露/).waitFor();
  await disclosurePreview.getByText(/RC 1 · 发布观察 2 · 实验 0 · 学习 \d+ · 批次 1 · 回滚 0/).waitFor();
  assert.equal(await disclosurePreview.getByRole('button', { name: '导出已预览归档' }).isDisabled(), true);
  await disclosurePreview.getByLabel('接受归档依赖闭包').check();
  const downloadPromise = page.waitForEvent('download');
  await disclosurePreview.getByRole('button', { name: '导出已预览归档' }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.hfarchive\.json$/);
  const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(downloaded.policy.includesOriginalMedia, false);
  assert.equal(downloaded.version, 3);
  assert.equal(downloaded.disclosure.mode, 'full');
  assert.equal(downloaded.manifest.sections.disclosurePolicy.sha256.length, 64);
  assert.equal(downloaded.sections.postPublishBatchSessions.length, 1);
  assert.equal(downloaded.sections.postPublishBatchRollbacks.length, 0);
  assert.equal(downloaded.manifest.sections.postPublishBatchSessions.sha256.length, 64);
  assert.equal(downloaded.sourceReferences[0].path, 'D:\\offline\\long-source.mp4');
  assert.equal(JSON.stringify(downloaded).includes('987654321'), true);

  await page.evaluate(() => {
    const candidate = { path: 'E:\\relocated\\long-source.mp4', status: 'available', size: 987654321, mtimeMs: 456, quickSha256: 'archive-source-quick-hash', duration: 3600, width: 1920, height: 1080 };
    window.hyperframesElectron = {
      registerSourceMedia: async () => ({ url: '' }),
      getReleaseRenderStatus: async () => ({ available: false }),
      onReleaseRenderProgress: () => () => {}, onReleaseRenderResult: () => () => {},
      onSourceStoryPreviewProgress: () => () => {},
      getSourceTranscriptionCapabilities: async () => ({ available: false, models: [] }),
      onSourceProxyProgress: () => () => {}, onSourceTranscriptionProgress: () => () => {},
      onSourceTranscriptionResult: () => () => {}, onSourceTranscriptionError: () => () => {},
      inspectArchiveSourceReferences: async (paths) => paths.map((path) => path === candidate.path ? { ...candidate } : { path, status: 'missing' }),
      selectArchiveRelocationCandidate: async () => ({ canceled: false, inspection: { ...candidate } }),
    };
  });

  await panel.getByLabel('选择工程恢复包').setInputFiles({ name: 'restore.hfarchive.json', mimeType: 'application/json', buffer: Buffer.from(archiveText) });
  const preview = panel.getByLabel('工程归档恢复预览');
  await preview.getByText(/全部数据段 SHA-256 通过/).waitFor();
  await preview.getByText(/批次会话 1 · 回滚回执 0/).waitFor();
  await preview.getByText(/原路径离线/).waitFor();
  assert.match(await preview.textContent(), /当前安全工程/);
  const before = await page.evaluate(async () => {
    const [{ useEditorStore }, persistence] = await Promise.all([import('/src/store/editorStore.ts'), import('/src/lib/persistence.ts')]);
    return {
      projectName: useEditorStore.getState().projectName,
      checkpoints: (await persistence.loadRecoveryCheckpoints()).length,
      archives: (await persistence.loadImportedProjectArchives()).length,
      releases: (await persistence.loadReleaseCandidates()).length,
      observations: (await persistence.loadPostPublishObservations()).length,
      sessions: (await persistence.loadPostPublishBatchSessions()).length,
      rollbacks: (await persistence.loadPostPublishBatchRollbacks()).length,
    };
  });
  assert.deepEqual(before, { projectName: '当前安全工程', checkpoints: 0, archives: 0, releases: 1, observations: 2, sessions: 1, rollbacks: 0 });

  await preview.getByRole('button', { name: '生成只读恢复差异审计' }).click();
  const auditPreview = preview.getByLabel('归档恢复差异审计预览');
  await auditPreview.getByText(/新增 0 · 相同 4 · 同 ID 冲突 0/).waitFor();
  await auditPreview.getByText(/离线 1/).waitFor();
  await auditPreview.getByText(/整体 SHA-256：[0-9a-f]{64}/).waitFor();
  const jsonDownloadPromise = page.waitForEvent('download');
  await auditPreview.getByRole('button', { name: '下载差异审计 JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  const auditJson = JSON.parse(await readFile(await jsonDownload.path(), 'utf8'));
  assert.equal(auditJson.format, 'hyperframes-archive-restore-diff-audit');
  assert.equal(auditJson.archive.version, 2); assert.equal(auditJson.archive.disclosureMode, 'legacy-full');
  assert.equal(auditJson.summary.identicalRecords, 4); assert.equal(auditJson.summary.sourceStatuses.missing, 1);
  const htmlDownloadPromise = page.waitForEvent('download');
  await auditPreview.getByRole('button', { name: '下载差异审计 HTML' }).click();
  const htmlDownload = await htmlDownloadPromise;
  const auditHtml = await readFile(await htmlDownload.path(), 'utf8');
  assert(!/https?:\/\//.test(auditHtml));
  const embedded = auditHtml.match(/<script id="archive-restore-audit-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert(embedded);
  const htmlReport = JSON.parse(embedded.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  assert.equal(htmlReport.manifest.auditSha256, auditJson.manifest.auditSha256);
  const auditVerificationInput = panel.getByLabel('选择恢复差异审计验证文件');
  await auditVerificationInput.setInputFiles({ name: 'valid.restore-audit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(auditJson)) });
  let auditVerification = panel.getByLabel('恢复差异审计验证结果');
  await auditVerification.getByText('验证状态：全部通过').waitFor();
  await auditVerification.getByText('collections：通过').waitFor();
  await auditVerification.getByText('整份审计：通过', { exact: false }).waitFor();
  const maliciousAuditHtml = auditHtml.replace('</body>', '<script>window.restoreAuditAttack = true</script></body>');
  await auditVerificationInput.setInputFiles({ name: 'malicious.restore-audit.html', mimeType: 'text/html', buffer: Buffer.from(maliciousAuditHtml) });
  auditVerification = panel.getByLabel('恢复差异审计验证结果');
  await auditVerification.getByText('验证状态：全部通过').waitFor();
  assert.equal(await page.evaluate(() => window.restoreAuditAttack), undefined, 'uploaded restore audit HTML scripts must never execute');
  const tamperedAudit = structuredClone(auditJson); tamperedAudit.sections.collections[0].newCount += 1;
  await auditVerificationInput.setInputFiles({ name: 'tampered.restore-audit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tamperedAudit)) });
  auditVerification = panel.getByLabel('恢复差异审计验证结果');
  await auditVerification.getByText('验证状态：验证失败').waitFor();
  await auditVerification.getByText('collections：篡改或不一致').waitFor();
  await auditVerification.getByText('整份审计：哈希不一致', { exact: false }).waitFor();
  const rightAuditText = await page.evaluate(async (archiveTextValue) => {
    const [archiveLib, restoreAuditLib, persistence, { useEditorStore }] = await Promise.all([import('/src/lib/projectArchive.ts'), import('/src/lib/archiveRestoreAudit.ts'), import('/src/lib/persistence.ts'), import('/src/store/editorStore.ts')]);
    const archiveValue = archiveLib.parseProjectArchive(archiveTextValue);
    const current = {
      releaseCandidates: await persistence.loadReleaseCandidates(), postPublishObservations: await persistence.loadPostPublishObservations(), postPublishExperiments: await persistence.loadPostPublishExperiments(),
      directorLearning: await persistence.loadDirectorLearningRecords(), postPublishBatchSessions: await persistence.loadPostPublishBatchSessions(), postPublishBatchRollbacks: await persistence.loadPostPublishBatchRollbacks(),
    };
    const changedInspection = [{ path: 'D:\\offline\\long-source.mp4', status: 'available', size: 987654321, quickSha256: 'changed-source-sha' }];
    const changedPreview = await archiveLib.previewProjectArchive(archiveValue, useEditorStore.getState().projectName, current, changedInspection);
    return JSON.stringify(await restoreAuditLib.createArchiveRestoreAudit(changedPreview, current, new Date('2026-09-21T00:00:00.000Z')));
  }, archiveText);
  const auditDiffArea = panel.getByLabel('恢复差异审计版本对比');
  await auditDiffArea.getByLabel('选择左侧恢复差异审计').setInputFiles({ name: 'left.restore-audit.html', mimeType: 'text/html', buffer: Buffer.from(auditHtml) });
  await auditDiffArea.getByText(/左侧：left\.restore-audit\.html · 验证通过/).waitFor();
  await auditDiffArea.getByLabel('选择右侧恢复差异审计').setInputFiles({ name: 'right-tampered.restore-audit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tamperedAudit)) });
  await auditDiffArea.getByText(/右侧：right-tampered\.restore-audit\.json · 验证失败/).waitFor();
  assert.equal(await auditDiffArea.getByRole('button', { name: '生成恢复审计版本对比' }).isDisabled(), true);
  await auditDiffArea.getByLabel('选择右侧恢复差异审计').setInputFiles({ name: 'right.restore-audit.json', mimeType: 'application/json', buffer: Buffer.from(rightAuditText) });
  await auditDiffArea.getByText(/右侧：right\.restore-audit\.json · 验证通过/).waitFor();
  await auditDiffArea.getByRole('button', { name: '生成恢复审计版本对比' }).click();
  const auditDiffPreview = panel.getByLabel('恢复差异审计版本对比预览');
  await auditDiffPreview.getByText(/素材状态：新增 0 · 移除 0 · 变化 1/).waitFor();
  await auditDiffPreview.getByText(/字段 status/).waitFor();
  const auditDiffJsonPromise = page.waitForEvent('download'); await auditDiffPreview.getByRole('button', { name: '下载恢复审计对比 JSON' }).click();
  const auditDiffJsonDownload = await auditDiffJsonPromise; const auditDiffReport = JSON.parse(await readFile(await auditDiffJsonDownload.path(), 'utf8'));
  assert.equal(auditDiffReport.format, 'hyperframes-archive-restore-audit-diff'); assert.equal(auditDiffReport.sections.sources.summary.changed, 1);
  const auditDiffHtmlPromise = page.waitForEvent('download'); await auditDiffPreview.getByRole('button', { name: '下载恢复审计对比 HTML' }).click();
  const auditDiffHtmlDownload = await auditDiffHtmlPromise; const auditDiffHtml = await readFile(await auditDiffHtmlDownload.path(), 'utf8');
  const auditDiffEmbedded = auditDiffHtml.match(/<script id="archive-restore-audit-diff-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert(auditDiffEmbedded); assert.equal(JSON.parse(auditDiffEmbedded).manifest.comparisonSha256, auditDiffReport.manifest.comparisonSha256);
  assert(!/https?:\/\//.test(auditDiffHtml));
  const auditDiffVerificationInput = panel.getByLabel('选择恢复审计版本对比验证文件');
  await auditDiffVerificationInput.setInputFiles({ name: 'valid.restore-audit-diff.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(auditDiffReport)) });
  let auditDiffVerification = panel.getByLabel('恢复差异审计版本对比验证结果');
  await auditDiffVerification.getByText('验证状态：全部通过').waitFor();
  await auditDiffVerification.getByText('sources：通过').waitFor();
  await auditDiffVerification.getByText('整份对比：通过', { exact: false }).waitFor();
  const maliciousAuditDiffHtml = auditDiffHtml.replace('</body>', '<script>window.archiveRestoreAuditDiffAttack = true</script></body>');
  await auditDiffVerificationInput.setInputFiles({ name: 'malicious.restore-audit-diff.html', mimeType: 'text/html', buffer: Buffer.from(maliciousAuditDiffHtml) });
  auditDiffVerification = panel.getByLabel('恢复差异审计版本对比验证结果');
  await auditDiffVerification.getByText('验证状态：全部通过').waitFor();
  assert.equal(await page.evaluate(() => window.archiveRestoreAuditDiffAttack), undefined, 'uploaded restore audit diff HTML scripts must never execute');
  const tamperedAuditDiff = structuredClone(auditDiffReport); tamperedAuditDiff.sections.sources.summary.changed += 1;
  await auditDiffVerificationInput.setInputFiles({ name: 'tampered.restore-audit-diff.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tamperedAuditDiff)) });
  auditDiffVerification = panel.getByLabel('恢复差异审计版本对比验证结果');
  await auditDiffVerification.getByText('验证状态：验证失败').waitFor();
  await auditDiffVerification.getByText('sources：篡改或不一致').waitFor();
  await auditDiffVerification.getByText('整份对比：哈希不一致', { exact: false }).waitFor();
  const afterAudit = await page.evaluate(async () => {
    const [{ useEditorStore }, persistence] = await Promise.all([import('/src/store/editorStore.ts'), import('/src/lib/persistence.ts')]);
    return {
      projectName: useEditorStore.getState().projectName,
      checkpoints: (await persistence.loadRecoveryCheckpoints()).length,
      archives: (await persistence.loadImportedProjectArchives()).length,
      releases: (await persistence.loadReleaseCandidates()).length,
      observations: (await persistence.loadPostPublishObservations()).length,
      sessions: (await persistence.loadPostPublishBatchSessions()).length,
      rollbacks: (await persistence.loadPostPublishBatchRollbacks()).length,
    };
  });
  assert.deepEqual(afterAudit, before, 'audit preview and downloads must not mutate project, evidence, archives or checkpoints');

  await preview.getByRole('button', { name: '选择候选文件' }).click();
  const relocation = preview.getByLabel('原片重定位核对 long-source.mp4');
  await relocation.getByText(/E:\\relocated\\long-source.mp4/).waitFor();
  await relocation.getByText(/文件大小：.*一致/).waitFor();
  await relocation.getByText(/视频时长：.*一致/).waitFor();
  await relocation.getByText(/快速哈希：一致/).waitFor();
  assert.equal(await preview.getByRole('button', { name: '恢复为新工程副本' }).isDisabled(), true);
  await relocation.getByLabel('确认重定位 long-source.mp4').check();
  await relocation.getByRole('button', { name: '建立副本路径映射' }).click();
  await relocation.getByText(/已确认映射/).waitFor();

  await preview.getByLabel('确认恢复为独立副本').check({ force: true });
  await page.waitForTimeout(200);
  assert.deepEqual(errors, [], `browser errors after global confirmation: ${errors.join(' | ')}`);
  const restoreButton = preview.getByRole('button', { name: '恢复为新工程副本' });
  assert.equal(await restoreButton.isDisabled(), false, 'restore button should enable after per-source and global confirmations');
  await restoreButton.click();
  await page.waitForTimeout(1000);
  const after = await page.evaluate(async () => {
    const [{ useEditorStore }, persistence] = await Promise.all([import('/src/store/editorStore.ts'), import('/src/lib/persistence.ts')]);
    const state = useEditorStore.getState();
    const checkpoints = await persistence.loadRecoveryCheckpoints();
    const archives = await persistence.loadImportedProjectArchives();
    return {
      projectName: state.projectName,
      sourcePath: state.sourceMedia[0]?.path,
      sourceStatus: state.sourceMedia[0]?.status,
      checkpointName: checkpoints[0]?.snapshot.projectName,
      checkpoints: checkpoints.length,
      archives: archives.length,
      relocationPath: archives[0]?.sourceRelocations?.[0]?.candidate.path,
      archivedOriginalPath: archives[0]?.archive.sections.project.sourceMedia?.[0]?.path,
      releases: (await persistence.loadReleaseCandidates()).length,
      observations: (await persistence.loadPostPublishObservations()).length,
      batchSessions: (await persistence.loadPostPublishBatchSessions()).length,
      batchRollbacks: (await persistence.loadPostPublishBatchRollbacks()).length,
    };
  });
  assert.match(after.projectName, /浏览器归档工程（归档恢复副本/);
  assert.equal(after.sourcePath, 'E:\\relocated\\long-source.mp4');
  assert.equal(after.sourceStatus, 'original');
  assert.equal(after.checkpointName, '当前安全工程');
  assert.equal(after.checkpoints, 1); assert.equal(after.archives, 1); assert.equal(after.releases, 1); assert.equal(after.observations, 2);
  assert.equal(after.batchSessions, 1); assert.equal(after.batchRollbacks, 0);
  assert.equal(after.relocationPath, 'E:\\relocated\\long-source.mp4');
  assert.equal(after.archivedOriginalPath, 'D:\\offline\\long-source.mp4');
  assert.deepEqual(errors, []);
  console.log('Project archive browser checks passed: v3 export, v2 restore audit generation/verification/two-report comparison, JSON/HTML parity, tamper/script gates, immutable state, checkpointed recovery and controlled relocation.');
} finally { await browser.close(); }
