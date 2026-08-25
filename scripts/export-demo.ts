/**
 * 冒烟测试辅助：用编辑器 demo 工程生成一份导出 HTML。
 * 运行：npx tsx scripts/export-demo.ts <输出路径>
 */
import { writeFileSync } from 'node:fs';
import { useEditorStore } from '../src/store/editorStore';
import { generateHyperFramesHtml } from '../src/lib/exportHtml';

const out = process.argv[2];
if (!out) {
  console.error('用法：npx tsx scripts/export-demo.ts <输出路径>');
  process.exit(1);
}

const store = useEditorStore.getState();
store.loadDemo();
const snapshot = store.exportSnapshot();
writeFileSync(out, generateHyperFramesHtml(snapshot), 'utf8');
console.log(`已生成 ${out}，blocks=${snapshot.blocks.length}`);
