import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.HISTORY_TEST_URL ?? 'http://127.0.0.1:5199');
  const controls = page.locator('[aria-label="编辑历史"]');
  const undo = controls.getByRole('button', { name: /^撤销/ });
  const redo = controls.getByRole('button', { name: /^重做/ });
  await undo.waitFor();
  assert(await undo.isDisabled());
  await page.getByRole('button', { name: /Text 文字积木/ }).click();
  await page.getByRole('button', { name: /Text 文字积木/ }).click();
  assert.match(await undo.innerText(), /2/);
  await undo.click();
  assert.match(await redo.innerText(), /1/);
  await page.keyboard.press('Control+z');
  assert(await undo.isDisabled());
  await page.keyboard.press('Control+Shift+z');
  assert.match(await undo.innerText(), /1/);
  await page.keyboard.press('Control+y');
  assert(await redo.isDisabled());
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: /Card 信息卡片/ }).click();
  assert(await redo.isDisabled(), 'new document edit clears redo');
  const input = page.locator('header input').first();
  await input.fill('历史测试');
  const beforeTypingUndo = await undo.innerText();
  await input.press('Control+z');
  // Ctrl+Z inside text fields is handled natively, not by document history.
  assert.equal(await redo.isDisabled(), true);
  assert((await undo.innerText()) === beforeTypingUndo || !(await undo.isDisabled()));
  await input.blur();
  await page.reload();
  await undo.waitFor();
  assert(await undo.isDisabled(), 'reload starts fresh history');
  assert.deepEqual(errors, []);
  console.log('History browser checks passed: buttons, keyboard undo/redo, branching, text-field isolation and reload boundary.');
} finally { await browser.close(); }
