import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { createPostPublishObservation } from '../src/lib/postPublishFeedback';
import { applyPlatformMappingTemplate, confirmPlatformBatch, confirmPlatformMapping, createPlatformMappingTemplate, parsePlatformExportFile, previewPlatformBatch, previewPlatformMapping, suggestPlatformMappings } from '../src/lib/platformDataAdapter';

const csv = '\uFEFF作品ID,发布时间,播放量,完播率,平均观看时长,备注\n"BV,quoted",2026-09-18T08:00:00+08:00,"1,234",0.42,7.5,"内部,备注"\n';
const dataset = await parsePlatformExportFile(new File([csv], 'bilibili-export.csv', { type: 'text/csv' }));
assert.equal(dataset.format, 'csv');
assert.equal(dataset.rows.length, 1);
assert.equal(dataset.rows[0]['作品ID'], 'BV,quoted');
assert.equal(dataset.fileSha256.length, 64);

const suggested = suggestPlatformMappings(dataset.headers);
const mappings = suggested.map((item) => item.sourceField === '完播率' ? { ...item, unit: 'ratio' as const, suggested: false } : item);
assert.equal(mappings.find((item) => item.sourceField === '作品ID')?.targetField, 'contentId');
assert.equal(mappings.find((item) => item.sourceField === '发布时间')?.targetField, 'publishedAt');
assert.equal(mappings.find((item) => item.sourceField === '备注')?.targetField, 'ignore');
assert.equal(suggested.find((item) => item.sourceField === '完播率')?.unit, 'percent');
assert.equal(mappings.find((item) => item.sourceField === '完播率')?.unit, 'ratio');

let preview = previewPlatformMapping(dataset, 0, mappings, { rcId: '', platform: '', accountLabel: '', manualObservedAt: '' });
assert(preview.blockers.some((item) => item.includes('冻结 RC')));
assert(preview.blockers.some((item) => item.includes('平台')));
assert(preview.blockers.some((item) => item.includes('账号')));
assert(preview.blockers.some((item) => item.includes('观测时间')));

const context = { rcId: 'rc-explicit', platform: 'B站', accountLabel: '账号 A', manualObservedAt: '2026-09-19T08:00:00+08:00' };
preview = previewPlatformMapping(dataset, 0, mappings, context);
assert.equal(preview.blockers.length, 0);
assert.equal(preview.windowHours, 24);
assert.equal(preview.input?.metrics.views, 1234);
assert.equal(preview.input?.metrics.completionRate, 42);
assert.equal(preview.input?.metrics.averageWatchSeconds, 7.5);
assert.deepEqual(preview.ignoredFields, ['备注']);
assert.throws(() => confirmPlatformMapping(preview, false), /确认/);
const input = confirmPlatformMapping(preview, true, new Date('2026-09-19T09:00:00.000Z'));
assert.equal(input.source.kind, 'platform-export');
assert.equal(input.source.sourceFileName, 'bilibili-export.csv');
assert.equal(input.source.sourceFileSha256, dataset.fileSha256);
assert.equal(input.source.mappingReceipt?.rowIndex, 0);
assert.equal(input.source.mappingReceipt?.confirmedAt, '2026-09-19T09:00:00.000Z');
assert.deepEqual(input.source.mappingReceipt?.ignoredFields, ['备注']);

const plan: ScenePlan = { projectName: '平台适配', scenes: [{ id: 's1', duration: 20, blocks: [{ type: 'text', content: 'test', duration: 20 }] }] };
const rc = createReleaseCandidate(scenePlanToSnapshot(plan), [], new Date('2026-09-18T00:00:00.000Z'));
rc.id = 'rc-explicit';
rc.render = { outputPath: 'final.mp4', reportPath: 'report.json', sha256: 'platform-adapter-render', renderedAt: '2026-09-18T01:00:00.000Z' };
const observation = createPostPublishObservation(input, [rc], new Date('2026-09-20T00:00:00.000Z'));
assert.equal(observation.rcId, 'rc-explicit');
assert.equal(observation.renderSha256, 'platform-adapter-render');
assert.equal(observation.source.accountLabel, '账号 A');
assert.equal(observation.source.mappingReceipt?.fields.some((item) => item.targetField === 'completionRate' && item.unit === 'ratio'), true);

const duplicate = mappings.map((item) => item.sourceField === '播放量' ? { ...item, targetField: 'contentId' as const, unit: 'text' as const } : item);
preview = previewPlatformMapping(dataset, 0, duplicate, context);
assert(preview.blockers.some((item) => item.includes('重复映射')));

await assert.rejects(() => parsePlatformExportFile(new File(['{"data":[{"播放量":1}]}'], 'ambiguous.json')), /对象数组/);
await assert.rejects(() => parsePlatformExportFile(new File(['legacy'], 'legacy.xls')), /仅支持/);
const jsonDataset = await parsePlatformExportFile(new File(['{"rows":[{"内容ID":"x","播放量":9}]}'], 'explicit.json'));
assert.deepEqual(jsonDataset.headers, ['内容ID', '播放量']);

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('导出');
sheet.addRow(['作品ID', '发布时间', '播放量']);
sheet.addRow(['note-1', new Date('2026-09-18T00:00:00.000Z'), 88]);
const xlsx = await workbook.xlsx.writeBuffer();
const xlsxDataset = await parsePlatformExportFile(new File([xlsx as ArrayBuffer], 'xiaohongshu-export.xlsx'));
assert.equal(xlsxDataset.format, 'xlsx');
assert.equal(xlsxDataset.rows[0]['播放量'], 88);
assert(xlsxDataset.rows[0]['发布时间'] instanceof Date);

const batchCsv = '\uFEFF作品ID,发布时间,观测时间,播放量,完播率\nBV-1,2026-09-18T08:00:00+08:00,2026-09-19T08:00:00+08:00,1000,40\nBV-2,2026-09-18T09:00:00+08:00,2026-09-19T09:00:00+08:00,1200,45\n';
const batchDataset = await parsePlatformExportFile(new File([batchCsv], 'batch.csv', { type: 'text/csv' }));
const batchMappings = suggestPlatformMappings(batchDataset.headers).map((item) => ({ ...item, suggested: false }));
assert.throws(() => createPlatformMappingTemplate('', batchDataset, batchMappings, { platform: 'B站', accountLabel: '账号 A' }, true), /名称/);
assert.throws(() => createPlatformMappingTemplate('B站模板', batchDataset, batchMappings, { platform: 'B站', accountLabel: '账号 A' }, false), /人工确认/);
const template = createPlatformMappingTemplate('B站模板', batchDataset, batchMappings, { platform: 'B站', accountLabel: '账号 A' }, true, new Date('2026-09-19T10:00:00.000Z'));
assert.equal(template.mappings.every((item) => item.suggested === false), true);
assert.deepEqual(applyPlatformMappingTemplate(template, batchDataset).mappings, template.mappings);
assert.throws(() => applyPlatformMappingTemplate(template, dataset), /表头与模板不一致/);
const badUnits = batchMappings.map((item) => item.sourceField === '完播率' ? { ...item, unit: 'seconds' as const } : item);
assert.throws(() => createPlatformMappingTemplate('错误单位', batchDataset, badUnits, { platform: 'B站', accountLabel: '账号 A' }, true), /未知或不适用/);

let batchPreview = previewPlatformBatch(batchDataset, template.mappings, { platform: template.platform, accountLabel: template.accountLabel }, [{ rcId: 'rc-explicit', confirmed: true }, { rcId: '', confirmed: false }]);
assert.equal(batchPreview.ready, false);
assert(batchPreview.blockers.some((item) => item.includes('第 3 行') && item.includes('冻结 RC')));
batchPreview = previewPlatformBatch(batchDataset, template.mappings, { platform: template.platform, accountLabel: template.accountLabel }, [{ rcId: 'rc-explicit', confirmed: true }, { rcId: 'rc-explicit', confirmed: true }]);
assert.equal(batchPreview.ready, true);
const batchInputs = confirmPlatformBatch(batchPreview, new Date('2026-09-19T11:00:00.000Z'));
assert.equal(batchInputs.length, 2);
assert.deepEqual(batchInputs.map((item) => item.source.mappingReceipt?.rowIndex), [0, 1]);
assert(batchInputs.every((item) => item.source.mappingReceipt?.confirmedAt === '2026-09-19T11:00:00.000Z'));
const firstBatchObservation = createPostPublishObservation(batchInputs[0], [rc], new Date('2026-09-20T00:00:00.000Z'));
batchPreview = previewPlatformBatch(batchDataset, template.mappings, { platform: template.platform, accountLabel: template.accountLabel }, [{ rcId: 'rc-explicit', confirmed: true }, { rcId: 'rc-explicit', confirmed: true }], [firstBatchObservation]);
assert.equal(batchPreview.ready, false);
assert(batchPreview.blockers.some((item) => item.includes('已经存在')));
const duplicateDataset = { ...batchDataset, rows: [batchDataset.rows[0], structuredClone(batchDataset.rows[0])] };
batchPreview = previewPlatformBatch(duplicateDataset, template.mappings, { platform: template.platform, accountLabel: template.accountLabel }, [{ rcId: 'rc-explicit', confirmed: true }, { rcId: 'rc-explicit', confirmed: true }]);
assert(batchPreview.blockers.some((item) => item.includes('批次内存在')));

console.log('Platform data adapter checks passed: CSV/XLSX/JSON parsing, confirmed reusable templates, full-batch row/RC/time gates, conflict blocking, units, receipts and standard observation conversion.');
