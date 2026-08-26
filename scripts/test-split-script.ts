/** 分句逻辑单测：npx tsx scripts/test-split-script.ts */
import { splitScript } from '../src/lib/pipeline/voiceover';

const cases: Array<[string, number, string]> = [
  ['第一句话。第二句话！第三句？', 3, '基本句末标点'],
  ['带换行的一句。\n另一句。', 2, '换行切分'],
  ['有分号；也算一句。', 2, '分号切分'],
  ['English. Works too! Nice?', 3, '英文标点'],
  ['。！？', 0, '纯标点应过滤'],
  ['', 0, '空文本'],
];

let failed = 0;
for (const [input, expected, label] of cases) {
  const result = splitScript(input);
  const ok = result.length === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(result)}`);
}
if (failed) {
  console.error(`${failed} 个用例失败`);
  process.exit(1);
}
console.log('SPLIT SCRIPT TEST OK');
