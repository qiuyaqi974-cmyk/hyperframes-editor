import { readFirstSheetRows, type XlsxRow } from '@/lib/ingest/spreadsheet';
import type { PostPublishObservation, PostPublishObservationInput, PostPublishMetrics } from '@/lib/postPublishFeedback';

export type PlatformExportFormat = 'csv' | 'xlsx' | 'json';
export type PlatformTargetField = 'ignore' | 'contentId' | 'publishedAt' | 'observedAt' | 'views' | 'averageWatchSeconds' | 'completionRate' | 'commentTotal' | 'questions' | 'objections' | 'positive' | 'retention';
export type PlatformFieldUnit = 'text' | 'datetime' | 'count' | 'seconds' | 'percent' | 'ratio' | 'retention-percent' | 'retention-ratio';

export interface PlatformExportDataset {
  fileName: string;
  fileSha256: string;
  format: PlatformExportFormat;
  headers: string[];
  rows: Array<Record<string, unknown>>;
}

export interface PlatformFieldMapping {
  sourceField: string;
  targetField: PlatformTargetField;
  unit: PlatformFieldUnit;
  suggested?: boolean;
}

export interface PlatformAdapterContext {
  rcId: string;
  platform: string;
  accountLabel: string;
  manualObservedAt?: string;
}

export interface PlatformMappingPreview {
  blockers: string[];
  warnings: string[];
  input?: PostPublishObservationInput;
  mapped: Array<{ sourceField: string; targetField: Exclude<PlatformTargetField, 'ignore'>; unit: PlatformFieldUnit; rawValue: unknown; convertedValue: unknown }>;
  ignoredFields: string[];
  windowHours?: number;
}

export interface PlatformMappingTemplate {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  format: PlatformExportFormat;
  headers: string[];
  mappings: PlatformFieldMapping[];
  platform: string;
  accountLabel: string;
}

export interface PlatformBatchRowPreview extends PlatformMappingPreview {
  rowIndex: number;
  rcId: string;
  confirmed: boolean;
}

export interface PlatformBatchPreview {
  rows: PlatformBatchRowPreview[];
  blockers: string[];
  ready: boolean;
}

export const TARGET_LABELS: Record<PlatformTargetField, string> = {
  ignore: '忽略', contentId: '发布链接/内容 ID', publishedAt: '发布时间', observedAt: '观测时间', views: '播放量',
  averageWatchSeconds: '平均观看秒数', completionRate: '完播率', commentTotal: '评论总数', questions: '提问评论数',
  objections: '质疑评论数', positive: '正向评论数', retention: '留存曲线',
};

const aliases: Record<Exclude<PlatformTargetField, 'ignore'>, string[]> = {
  contentId: ['内容id', '内容编号', '稿件id', '稿件编号', '视频id', '作品id', '笔记id', 'bvid', 'url', '链接', '分享链接'],
  publishedAt: ['发布时间', '投稿时间', '首次发布时间', '作品发布时间', '笔记发布时间', 'publish_time', 'published_at'],
  observedAt: ['数据更新时间', '统计时间', '观测时间', '截止时间', 'export_time', 'observed_at'],
  views: ['播放量', '播放次数', '视频播放量', '观看量', '曝光后播放', 'views', 'view_count'],
  averageWatchSeconds: ['平均观看时长', '人均观看时长', '平均播放时长', 'average_watch_seconds', 'avg_watch_time'],
  completionRate: ['完播率', '播放完成率', '平均播放完成度', 'completion_rate', 'finish_rate'],
  commentTotal: ['评论数', '评论量', '评论总数', 'comments', 'comment_count'],
  questions: ['提问评论数', '问题评论数', 'question_comments'],
  objections: ['质疑评论数', '反对评论数', 'objection_comments'],
  positive: ['正向评论数', '积极评论数', 'positive_comments'],
  retention: ['留存曲线', '观众留存', 'retention', 'retention_curve'],
};

export function unitsForPlatformTarget(target: PlatformTargetField): PlatformFieldUnit[] {
  if (target === 'contentId' || target === 'ignore') return ['text'];
  if (target === 'publishedAt' || target === 'observedAt') return ['datetime'];
  if (['views', 'commentTotal', 'questions', 'objections', 'positive'].includes(target)) return ['count'];
  if (target === 'averageWatchSeconds') return ['seconds'];
  if (target === 'completionRate') return ['percent', 'ratio'];
  return ['retention-percent', 'retention-ratio'];
}

function normalized(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s_%％()（）/\-]/g, '');
}

function defaultUnit(target: PlatformTargetField, source = ''): PlatformFieldUnit {
  if (target === 'contentId') return 'text';
  if (target === 'publishedAt' || target === 'observedAt') return 'datetime';
  if (['views', 'commentTotal', 'questions', 'objections', 'positive'].includes(target)) return 'count';
  if (target === 'averageWatchSeconds') return 'seconds';
  if (target === 'completionRate') return /比例|ratio|小数/i.test(source) ? 'ratio' : 'percent';
  if (target === 'retention') return /比例|ratio|小数/i.test(source) ? 'retention-ratio' : 'retention-percent';
  return 'text';
}

export function suggestPlatformMappings(headers: string[]): PlatformFieldMapping[] {
  const used = new Set<PlatformTargetField>();
  return headers.map((sourceField) => {
    const key = normalized(sourceField);
    const found = (Object.entries(aliases) as Array<[Exclude<PlatformTargetField, 'ignore'>, string[]]>).find(([target, names]) => !used.has(target) && names.some((name) => normalized(name) === key));
    if (!found) return { sourceField, targetField: 'ignore', unit: 'text' };
    used.add(found[0]);
    return { sourceField, targetField: found[0], unit: defaultUnit(found[0], sourceField), suggested: true };
  });
}

function parseCsv(text: string) {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', '\t', ';'];
  const delimiter = candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === delimiter) { row.push(cell); cell = ''; }
    else if (character === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += character;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  if (quoted) throw new Error('CSV 包含未闭合的引号。');
  return rows;
}

async function fileSha256(file: File) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function rowsFromGrid(grid: string[][]) {
  const headers = (grid[0] ?? []).map((item) => item.trim()).filter(Boolean);
  if (!headers.length) throw new Error('文件没有可用表头。');
  if (new Set(headers).size !== headers.length) throw new Error('文件包含重复表头，请先重命名后再导入。');
  const rows = grid.slice(1).filter((row) => row.some((cell) => cell.trim() !== '')).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
  return { headers, rows };
}

function normalizeRows(rows: XlsxRow[]) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!headers.length) throw new Error('文件没有可用表头。');
  return { headers, rows: rows.map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? '']))) };
}

export async function parsePlatformExportFile(file: File): Promise<PlatformExportDataset> {
  const lower = file.name.toLocaleLowerCase();
  let format: PlatformExportFormat;
  let parsed: { headers: string[]; rows: Array<Record<string, unknown>> };
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    format = 'csv'; parsed = rowsFromGrid(parseCsv(await file.text()));
  } else if (lower.endsWith('.xlsx')) {
    format = 'xlsx'; parsed = normalizeRows(await readFirstSheetRows(file));
  } else if (lower.endsWith('.json')) {
    format = 'json';
    const value = JSON.parse(await file.text()) as unknown;
    const rows = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows) ? (value as { rows: unknown[] }).rows : undefined;
    if (!rows || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('JSON 必须是对象数组，或只使用明确的 rows 对象数组。');
    parsed = normalizeRows(rows as XlsxRow[]);
  } else throw new Error('仅支持 CSV、TSV、XLSX 和 JSON 平台导出文件。');
  if (!parsed.rows.length) throw new Error('文件没有数据行。');
  return { fileName: file.name, fileSha256: await fileSha256(file), format, ...parsed };
}

function numberValue(raw: unknown, label: string) {
  const text = String(raw ?? '').trim().replace(/[,，]/g, '').replace(/%$/, '');
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`${label}“${String(raw)}”不是有效数字。`);
  return value;
}

function convert(target: PlatformTargetField, unit: PlatformFieldUnit, raw: unknown): unknown {
  if (target === 'contentId') return String(raw ?? '').trim();
  if (target === 'publishedAt' || target === 'observedAt') {
    const date = raw instanceof Date ? raw : new Date(String(raw ?? '').trim());
    if (!Number.isFinite(date.getTime())) throw new Error(`${TARGET_LABELS[target]}“${String(raw)}”不是有效日期。`);
    return date.toISOString();
  }
  if (target === 'retention') {
    const text = String(raw ?? '').trim();
    if (!text) return [];
    return text.split(/[,，;；\n]/).filter(Boolean).map((part) => {
      const pieces = part.trim().split(/[:：]/);
      if (pieces.length !== 2) throw new Error(`留存点“${part}”应为 秒:数值。`);
      const second = numberValue(pieces[0], '留存秒数')!;
      const value = numberValue(pieces[1], '留存率')!;
      return { second, rate: unit === 'retention-ratio' ? value * 100 : value };
    });
  }
  const value = numberValue(raw, TARGET_LABELS[target]);
  if (value === undefined) return undefined;
  if (target === 'completionRate' && unit === 'ratio') return value * 100;
  if (unit === 'count' && !Number.isInteger(value)) throw new Error(`${TARGET_LABELS[target]}必须是整数。`);
  return value;
}

const metricTargets: PlatformTargetField[] = ['views', 'averageWatchSeconds', 'completionRate', 'commentTotal', 'questions', 'objections', 'positive', 'retention'];

export function previewPlatformMapping(dataset: PlatformExportDataset, rowIndex: number, mappings: PlatformFieldMapping[], context: PlatformAdapterContext): PlatformMappingPreview {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const row = dataset.rows[rowIndex];
  if (!row) return { blockers: ['请选择有效的数据行。'], warnings, mapped: [], ignoredFields: dataset.headers };
  const active = mappings.filter((item) => item.targetField !== 'ignore');
  const targets = active.map((item) => item.targetField);
  for (const target of new Set(targets)) if (targets.filter((item) => item === target).length > 1) blockers.push(`${TARGET_LABELS[target]}被多个源字段重复映射。`);
  for (const required of ['contentId', 'publishedAt'] as PlatformTargetField[]) if (!targets.includes(required)) blockers.push(`必须明确映射${TARGET_LABELS[required]}。`);
  if (!targets.includes('observedAt') && !context.manualObservedAt?.trim()) blockers.push('必须映射观测时间，或手工填写文件对应的观测时间。');
  if (!metricTargets.some((target) => targets.includes(target))) blockers.push('至少映射一项发布指标。');
  if (!context.rcId) blockers.push('必须人工选择冻结 RC。');
  if (!context.platform.trim()) blockers.push('必须人工填写平台。');
  if (!context.accountLabel.trim()) blockers.push('必须人工填写账号或数据源标识。');
  const mapped: PlatformMappingPreview['mapped'] = [];
  const converted = new Map<PlatformTargetField, unknown>();
  for (const mapping of active) {
    if (!dataset.headers.includes(mapping.sourceField)) { blockers.push(`源字段 ${mapping.sourceField} 不存在。`); continue; }
    try {
      const value = convert(mapping.targetField, mapping.unit, row[mapping.sourceField]);
      converted.set(mapping.targetField, value);
      mapped.push({ ...mapping, targetField: mapping.targetField as Exclude<PlatformTargetField, 'ignore'>, rawValue: row[mapping.sourceField], convertedValue: value });
    } catch (error) { blockers.push(error instanceof Error ? error.message : String(error)); }
  }
  if (!targets.includes('observedAt') && context.manualObservedAt) {
    const date = new Date(context.manualObservedAt);
    if (!Number.isFinite(date.getTime())) blockers.push('手工观测时间无效。'); else converted.set('observedAt', date.toISOString());
  }
  const publishedAt = converted.get('publishedAt') as string | undefined;
  const observedAt = converted.get('observedAt') as string | undefined;
  let windowHours: number | undefined;
  if (publishedAt && observedAt) {
    windowHours = Number(((Date.parse(observedAt) - Date.parse(publishedAt)) / 3_600_000).toFixed(2));
    if (!(windowHours > 0)) blockers.push('观测时间必须晚于发布时间。');
  }
  const ignoredFields = dataset.headers.filter((header) => !active.some((mapping) => mapping.sourceField === header));
  if (ignoredFields.length) warnings.push(`${ignoredFields.length} 个源字段不会导入：${ignoredFields.join('、')}`);
  const metrics: PostPublishMetrics = {
    views: converted.get('views') as number | undefined,
    averageWatchSeconds: converted.get('averageWatchSeconds') as number | undefined,
    completionRate: converted.get('completionRate') as number | undefined,
    retention: (converted.get('retention') as PostPublishMetrics['retention'] | undefined) ?? [],
    comments: {
      total: converted.get('commentTotal') as number | undefined,
      questions: converted.get('questions') as number | undefined,
      objections: converted.get('objections') as number | undefined,
      positive: converted.get('positive') as number | undefined,
    },
  };
  const contentId = converted.get('contentId') as string | undefined;
  if (targets.includes('contentId') && !contentId) blockers.push('所选行的发布链接/内容 ID 为空。');
  const input = blockers.length ? undefined : {
    rcId: context.rcId,
    source: {
      kind: 'platform-export' as const,
      platform: context.platform.trim(), accountLabel: context.accountLabel.trim(), postUrl: contentId!, sourceFileName: dataset.fileName,
      sourceFileSha256: dataset.fileSha256,
      mappingReceipt: {
        rowIndex,
        fields: active.map(({ sourceField, targetField, unit }) => ({ sourceField, targetField, unit })),
        ignoredFields,
        confirmedAt: '',
      },
    },
    publishedAt: publishedAt!, observedAt: observedAt!, metrics,
  };
  return { blockers, warnings, input, mapped, ignoredFields, windowHours };
}

export function confirmPlatformMapping(preview: PlatformMappingPreview, confirmed: boolean, now = new Date()): PostPublishObservationInput {
  if (!confirmed) throw new Error('请先确认字段映射、指标单位、时间窗和未导入列。');
  if (preview.blockers.length || !preview.input) throw new Error('当前字段映射仍有阻断项，不能转换。');
  return {
    ...preview.input,
    source: {
      ...preview.input.source,
      mappingReceipt: preview.input.source.mappingReceipt ? { ...preview.input.source.mappingReceipt, confirmedAt: now.toISOString() } : undefined,
    },
  };
}

function validateReusableMappings(dataset: PlatformExportDataset, mappings: PlatformFieldMapping[]) {
  const blockers: string[] = [];
  const bySource = new Map(mappings.map((item) => [item.sourceField, item]));
  for (const header of dataset.headers) if (!bySource.has(header)) blockers.push(`模板缺少源字段 ${header}。`);
  for (const mapping of mappings) {
    if (!dataset.headers.includes(mapping.sourceField)) blockers.push(`源字段 ${mapping.sourceField} 不在当前文件中。`);
    if (!unitsForPlatformTarget(mapping.targetField).includes(mapping.unit)) blockers.push(`${mapping.sourceField} 使用了未知或不适用的单位 ${mapping.unit}。`);
  }
  const active = mappings.filter((item) => item.targetField !== 'ignore');
  const targets = active.map((item) => item.targetField);
  for (const target of new Set(targets)) if (targets.filter((item) => item === target).length > 1) blockers.push(`${TARGET_LABELS[target]}被多个源字段重复映射。`);
  for (const required of ['contentId', 'publishedAt', 'observedAt'] as PlatformTargetField[]) if (!targets.includes(required)) blockers.push(`安全批次模板必须映射${TARGET_LABELS[required]}。`);
  if (!metricTargets.some((target) => targets.includes(target))) blockers.push('安全批次模板至少需要一项发布指标。');
  return blockers;
}

export function createPlatformMappingTemplate(name: string, dataset: PlatformExportDataset, mappings: PlatformFieldMapping[], context: Pick<PlatformAdapterContext, 'platform' | 'accountLabel'>, confirmed: boolean, now = new Date()): PlatformMappingTemplate {
  if (!confirmed) throw new Error('请先人工确认字段、单位、平台和账号，再保存模板。');
  const templateName = name.trim();
  if (!templateName) throw new Error('请填写映射模板名称。');
  if (!context.platform.trim() || !context.accountLabel.trim()) throw new Error('模板必须保存明确的平台和账号标识。');
  const blockers = validateReusableMappings(dataset, mappings);
  if (blockers.length) throw new Error(blockers.join('；'));
  const timestamp = now.toISOString();
  return {
    id: `platform-template-${now.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    name: templateName, createdAt: timestamp, updatedAt: timestamp, format: dataset.format, headers: [...dataset.headers],
    mappings: mappings.map((item) => ({ sourceField: item.sourceField, targetField: item.targetField, unit: item.unit, suggested: false })),
    platform: context.platform.trim(), accountLabel: context.accountLabel.trim(),
  };
}

export function applyPlatformMappingTemplate(template: PlatformMappingTemplate, dataset: PlatformExportDataset) {
  const expected = [...template.headers].sort();
  const actual = [...dataset.headers].sort();
  if (template.format !== dataset.format) throw new Error(`模板格式为 ${template.format.toUpperCase()}，当前文件为 ${dataset.format.toUpperCase()}。`);
  if (expected.length !== actual.length || expected.some((item, index) => item !== actual[index])) throw new Error('当前文件表头与模板不一致，不能静默套用。');
  const blockers = validateReusableMappings(dataset, template.mappings);
  if (blockers.length) throw new Error(blockers.join('；'));
  return { mappings: structuredClone(template.mappings), platform: template.platform, accountLabel: template.accountLabel };
}

function observationConflictKey(rcId: string, platform: string, contentId: string, observedAt: string) {
  return [rcId.trim(), platform.trim().toLocaleLowerCase(), contentId.trim(), new Date(observedAt).toISOString()].join('|');
}

export function previewPlatformBatch(
  dataset: PlatformExportDataset,
  mappings: PlatformFieldMapping[],
  context: Pick<PlatformAdapterContext, 'platform' | 'accountLabel'>,
  rowStates: Array<{ rcId: string; confirmed: boolean }>,
  existing: PostPublishObservation[] = [],
): PlatformBatchPreview {
  const schemaBlockers = validateReusableMappings(dataset, mappings);
  const existingKeys = new Set(existing.map((item) => observationConflictKey(item.rcId, item.source.platform, item.source.postUrl, item.observedAt)));
  const seen = new Set<string>();
  const rows = dataset.rows.map((_, rowIndex): PlatformBatchRowPreview => {
    const state = rowStates[rowIndex] ?? { rcId: '', confirmed: false };
    const preview = previewPlatformMapping(dataset, rowIndex, mappings, { ...context, rcId: state.rcId, manualObservedAt: '' });
    const blockers = [...schemaBlockers, ...preview.blockers];
    if (preview.input) {
      const key = observationConflictKey(preview.input.rcId, preview.input.source.platform, preview.input.source.postUrl, preview.input.observedAt);
      if (existingKeys.has(key)) blockers.push('同一 RC、发布内容和观测时间的数据已经存在。');
      if (seen.has(key)) blockers.push('批次内存在相同 RC、发布内容和观测时间的重复行。');
      seen.add(key);
    }
    if (!state.confirmed) blockers.push('这一行尚未人工确认 RC、内容 ID、发布时间和观测时间。');
    return { ...preview, blockers: [...new Set(blockers)], rowIndex, rcId: state.rcId, confirmed: state.confirmed };
  });
  const blockers = rows.flatMap((row) => row.blockers.map((item) => `第 ${row.rowIndex + 2} 行：${item}`));
  if (dataset.rows.length > 100) blockers.unshift(`批次包含 ${dataset.rows.length} 行，超过单次安全上限 100。`);
  return { rows, blockers, ready: rows.length > 0 && blockers.length === 0 };
}

export function confirmPlatformBatch(preview: PlatformBatchPreview, now = new Date()): PostPublishObservationInput[] {
  if (!preview.ready || preview.blockers.length) throw new Error('批次仍有未确认、冲突或无效行，不能部分保存。');
  return preview.rows.map((row) => confirmPlatformMapping(row, row.confirmed, now));
}
