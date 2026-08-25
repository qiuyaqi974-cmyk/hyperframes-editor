/**
 * Excel 导入回归测试：用 exceljs 生成测试工作簿，验证两个导入方的解析结果。
 * 运行：node scripts/run-excel-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(root, 'node_modules', '.cache', 'excel-test.mjs');

const srcDir = path.join(root, 'src').split(path.sep).join('/');
const testCode = `
import ExcelJS from 'exceljs';
import { importContentCases } from '${srcDir}/lib/contentIntelligence/excelImporter';
import { cleanContentWorkbook } from '${srcDir}/lib/contentDatasetCleaner/excelImporter';

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('数据');
ws.addRow(['账号', '标题', '点赞数', '标签', '口播全文', '前三秒钩子']);
ws.addRow(['测试博主', '  零基础学AI  ', '1,234', 'AI,教程、干货', '这一期教你怎么用AI做视频，全程免费，看完就能上手操作。', '你还不会AI吗']);
ws.addRow(['广告博主', '限时优惠下单', '99', '推广', '点击下方链接购买。', '限时优惠']);

const buffer = await wb.xlsx.writeBuffer();
const file = new File([buffer], 'test.xlsx');

const cases = await importContentCases(file);
console.log('contentIntelligence:', JSON.stringify(cases[0]));
if (cases[0].title !== '零基础学AI') throw new Error('标题解析失败');
if (cases[0].likes !== 1234) throw new Error('点赞解析失败: ' + cases[0].likes);
if (cases[0].tags.length !== 3) throw new Error('标签解析失败');

const cleaned = await cleanContentWorkbook(file);
const first = cleaned.cases[0];
console.log('contentDatasetCleaner stats:', JSON.stringify(cleaned.stats));
if (first.creator !== '测试博主') throw new Error('creator 解析失败');
if (first.metrics.likes !== 1234) throw new Error('metrics.likes 解析失败');
if (first.usable !== true) throw new Error('第一条应为 usable');
if (cleaned.cases[1].isAdvertisement !== true) throw new Error('第二条应识别为广告');
if (cleaned.cases[1].adType !== 'pure') throw new Error('广告类型应为 pure');
console.log('EXCEL TEST OK');
`;

fs.mkdirSync(path.dirname(outfile), { recursive: true });
await esbuild.build({
  stdin: { contents: testCode, resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@': path.join(root, 'src') },
  outfile,
  logLevel: 'silent',
  external: ['exceljs'],
});

await import(pathToFileURL(outfile).href);
