import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const fixtureDir = process.env.FCPXML_CHECK_DIR;
assert(fixtureDir, 'Set FCPXML_CHECK_DIR to an isolated fixture directory.');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.FCPXML_TEST_URL ?? 'http://127.0.0.1:5199');
  await page.getByRole('button', { name: /AI 助手/ }).waitFor();
  const snapshot = JSON.parse(readFileSync(join(fixtureDir, 'ui-snapshot.json'), 'utf8'));
  await page.evaluate(async (value) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('hyperframes-editor-v3', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(value, 'autosave'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    });
  }, snapshot);
  await page.reload(); await page.getByRole('button', { name: /AI 助手/ }).click();
  const seeded = await page.evaluate(async () => { const { useEditorStore } = await import('/src/store/editorStore.ts'); const state = useEditorStore.getState(); return { versions: state.storyAssemblyVersions.length, selection: state.storyVersionSelection?.winnerVersionId, assembly: Boolean(state.storyAssembly) }; });
  assert.deepEqual(seeded, { versions: 2, selection: snapshot.storyVersionSelection.winnerVersionId, assembly: true });
  const media = page.getByRole('region', { name: '长视频源素材台' });
  if (!(await media.locator('input[accept*=".fcpxml"]').count())) await media.getByRole('button', { name: /长视频源素材台/ }).click();
  await page.getByText('粗剪方案版本', { exact: true }).waitFor();
  await page.locator('input[accept*=".fcpxml"]').setInputFiles(join(fixtureDir, 'reordered.fcpxml'));
  const save = page.getByRole('button', { name: '保存为派生方案' }); await save.waitFor(); await save.click();
  const state = await page.evaluate(async () => { const { useEditorStore } = await import('/src/store/editorStore.ts'); const versions = useEditorStore.getState().storyAssemblyVersions; return { count: versions.length, last: versions.at(-1), first: versions[0] }; });
  assert.equal(state.count, 3); assert.equal(state.last.provenance.kind, 'external-fcpxml'); assert.deepEqual(state.last.segments.map((item) => item.candidateId), ['c1', 'c0']); assert.deepEqual(state.first.segments.map((item) => item.candidateId), ['c0', 'c1']);
  await page.getByText('公开时间线（OTIO / FCPXML）', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 FCPXML', exact: true }).last().click();
  const download = await downloadPromise; const exported = readFileSync(await download.path(), 'utf8');
  assert.match(exported, /<fcpxml version="1\.10">/); assert(exported.indexOf('value="c1"') < exported.indexOf('value="c0"'));
  assert.deepEqual(errors, []);
  console.log('FCPXML browser smoke passed: file import, review save, immutable parent, provenance and exported download.');
} finally { await browser.close(); }
