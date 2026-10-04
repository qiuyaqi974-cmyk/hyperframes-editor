import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sourceFingerprint } from '../electron/sourceTranscription';
import { transcriptSelectionRange } from '../src/lib/sourceTranscription';

const wordRange = transcriptSelectionRange({
  id: 'word-level', start: 10, end: 14, text: '开始放盐',
  words: [
    { start: 10.4, end: 10.8, word: '开始' },
    { start: 11.1, end: 11.6, word: '放盐' },
  ],
}, 100);
assert.deepEqual(wordRange, { start: 10.32, end: 11.68 });
assert.deepEqual(transcriptSelectionRange({ id: 'srt', start: 1, end: 2, text: '字幕' }, 100), { start: 0.7, end: 2.3 });

const root = mkdtempSync(join(tmpdir(), 'hyperframes-transcription-test-'));
try {
  const source = join(root, 'source.mp4');
  writeFileSync(source, 'first');
  const first = sourceFingerprint(source);
  writeFileSync(source, 'changed-content');
  const second = sourceFingerprint(source);
  assert.notEqual(first, second, '素材改变后必须生成新的缓存指纹');

  const helper = resolve('tools/transcribe-local.py');
  const output = execFileSync('python', [helper, '--check'], { encoding: 'utf8' }).trim();
  const capabilities = JSON.parse(output) as { type: string; available: boolean; models: string[] };
  assert.equal(capabilities.type, 'capabilities');
  assert.equal(capabilities.available, true);
  assert.ok(capabilities.models.includes('base') || capabilities.models.includes('small'));
  console.log('Source transcription checks passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
