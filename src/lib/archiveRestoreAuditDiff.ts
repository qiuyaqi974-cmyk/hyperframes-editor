import { verifyArchiveRestoreAuditText, type ArchiveRestoreAuditReport } from '@/lib/archiveRestoreAudit';

export const ARCHIVE_RESTORE_AUDIT_DIFF_FORMAT = 'hyperframes-archive-restore-audit-diff' as const;
export const ARCHIVE_RESTORE_AUDIT_DIFF_VERSION = 1 as const;
export type ArchiveRestoreAuditDiffStatus = 'added' | 'removed' | 'changed' | 'identical';
export type ArchiveRestoreAuditDiffSectionName = 'records' | 'omissions' | 'capacities' | 'sources' | 'findings';

export interface ArchiveRestoreAuditDiffItem {
  id: string;
  status: ArchiveRestoreAuditDiffStatus;
  leftSha256?: string;
  rightSha256?: string;
  changes: Array<{ field: string; before?: unknown; after?: unknown }>;
}

export interface ArchiveRestoreAuditDiffSection {
  name: ArchiveRestoreAuditDiffSectionName;
  label: string;
  summary: Record<ArchiveRestoreAuditDiffStatus, number>;
  items: ArchiveRestoreAuditDiffItem[];
}

export interface ArchiveRestoreAuditDiffReport {
  format: typeof ARCHIVE_RESTORE_AUDIT_DIFF_FORMAT;
  version: typeof ARCHIVE_RESTORE_AUDIT_DIFF_VERSION;
  id: string;
  generatedAt: string;
  left: { id: string; archiveId: string; archiveVersion: number; disclosureMode: string; comparedAt: string; auditSha256: string };
  right: { id: string; archiveId: string; archiveVersion: number; disclosureMode: string; comparedAt: string; auditSha256: string };
  archiveMatch: { id: boolean; version: boolean; disclosureMode: boolean };
  summary: Record<ArchiveRestoreAuditDiffStatus, number>;
  statement: string;
  sections: Record<ArchiveRestoreAuditDiffSectionName, ArchiveRestoreAuditDiffSection>;
  warnings: string[];
  manifest: { algorithm: 'SHA-256'; canonicalization: 'sorted-json-v1'; sections: Record<ArchiveRestoreAuditDiffSectionName, { bytes: number; sha256: string }>; comparisonSha256: string };
}

export interface ArchiveRestoreAuditDiffVerification {
  status: 'verified' | 'failed' | 'unsupported'; fileType: 'json' | 'html'; format?: string; version?: number; generatedAt?: string;
  left?: Partial<ArchiveRestoreAuditDiffReport['left']>; right?: Partial<ArchiveRestoreAuditDiffReport['right']>;
  archiveMatch?: Partial<ArchiveRestoreAuditDiffReport['archiveMatch']>;
  unknownFields: string[]; errors: string[];
  sections: Array<{ name: ArchiveRestoreAuditDiffSectionName; status: 'verified' | 'tampered' | 'missing' | 'unsupported'; expectedBytes?: number; actualBytes?: number; expectedSha256?: string; actualSha256?: string }>;
  comparison: { status: 'verified' | 'tampered' | 'missing'; expectedSha256?: string; actualSha256?: string };
}

function canonicalize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

async function digest(value: unknown) {
  const encoded = new TextEncoder().encode(canonicalize(value));
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return { bytes: encoded.byteLength, sha256: [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('') };
}

function changes(left: unknown, right: unknown, path = ''): Array<{ field: string; before?: unknown; after?: unknown }> {
  if (canonicalize(left) === canonicalize(right)) return [];
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const before = left as Record<string, unknown>; const after = right as Record<string, unknown>;
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((key) => changes(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [{ field: path || '$', ...(left !== undefined ? { before: structuredClone(left) } : {}), ...(right !== undefined ? { after: structuredClone(right) } : {}) }];
}

async function compareSection(name: ArchiveRestoreAuditDiffSectionName, label: string, left: Map<string, unknown>, right: Map<string, unknown>): Promise<ArchiveRestoreAuditDiffSection> {
  const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
  const items = await Promise.all(ids.map(async (id): Promise<ArchiveRestoreAuditDiffItem> => {
    const before = left.get(id); const after = right.get(id);
    const [leftHash, rightHash] = await Promise.all([before === undefined ? undefined : digest(before), after === undefined ? undefined : digest(after)]);
    const status: ArchiveRestoreAuditDiffStatus = before === undefined ? 'added' : after === undefined ? 'removed' : leftHash?.sha256 === rightHash?.sha256 ? 'identical' : 'changed';
    return { id, status, ...(leftHash ? { leftSha256: leftHash.sha256 } : {}), ...(rightHash ? { rightSha256: rightHash.sha256 } : {}), changes: status === 'changed' ? changes(before, after) : [] };
  }));
  const summary = { added: 0, removed: 0, changed: 0, identical: 0 };
  items.forEach((item) => { summary[item.status] += 1; });
  return { name, label, summary, items };
}

function records(report: ArchiveRestoreAuditReport) {
  return new Map(report.sections.collections.flatMap((collection) => collection.items.map((item) => [`${collection.name}:${item.id}`, { collection: collection.name, ...item }] as const)));
}

function keyed<T>(items: T[], key: (item: T) => string) { return new Map(items.map((item) => [key(item), item])); }

async function assertVerified(report: ArchiveRestoreAuditReport, side: string) {
  const verification = await verifyArchiveRestoreAuditText(JSON.stringify(report), 'json');
  if (verification.status !== 'verified') throw new Error(`${side}恢复差异审计未通过独立验证，不能比较：${verification.errors.join('；')}`);
}

export async function createArchiveRestoreAuditDiff(left: ArchiveRestoreAuditReport, right: ArchiveRestoreAuditReport, now = new Date()): Promise<ArchiveRestoreAuditDiffReport> {
  await Promise.all([assertVerified(left, '左侧'), assertVerified(right, '右侧')]);
  const sectionList = await Promise.all([
    compareSection('records', '六类记录结果', records(left), records(right)),
    compareSection('omissions', '主动省略', keyed(left.sections.omissions, (item) => item.collection), keyed(right.sections.omissions, (item) => item.collection)),
    compareSection('capacities', '容量计算', keyed(left.sections.capacities, (item) => item.collection), keyed(right.sections.capacities, (item) => item.collection)),
    compareSection('sources', '素材状态', keyed(left.sections.sources, (item) => item.id), keyed(right.sections.sources, (item) => item.id)),
    compareSection('findings', '阻断与警告', new Map([['blockers', left.sections.findings.blockers], ['warnings', left.sections.findings.warnings]]), new Map([['blockers', right.sections.findings.blockers], ['warnings', right.sections.findings.warnings]])),
  ]);
  const sections = Object.fromEntries(sectionList.map((item) => [item.name, item])) as ArchiveRestoreAuditDiffReport['sections'];
  const summary = { added: 0, removed: 0, changed: 0, identical: 0 };
  sectionList.forEach((section) => (Object.keys(summary) as ArchiveRestoreAuditDiffStatus[]).forEach((status) => { summary[status] += section.summary[status]; }));
  const metadata = (report: ArchiveRestoreAuditReport) => ({ id: report.id, archiveId: report.archive.id, archiveVersion: report.archive.version, disclosureMode: report.archive.disclosureMode, comparedAt: report.comparedAt, auditSha256: report.manifest.auditSha256 });
  const leftMetadata = metadata(left); const rightMetadata = metadata(right);
  const archiveMatch = { id: left.archive.id === right.archive.id, version: left.archive.version === right.archive.version, disclosureMode: left.archive.disclosureMode === right.archive.disclosureMode };
  const warnings = [...(!archiveMatch.id ? ['两份审计来自不同归档 ID。'] : []), ...(!archiveMatch.version ? ['两份审计的归档版本不同。'] : []), ...(!archiveMatch.disclosureMode ? ['两份审计的披露模式不同。'] : [])];
  const sectionManifest = Object.fromEntries(await Promise.all(sectionList.map(async (section) => [section.name, await digest(section)] as const))) as ArchiveRestoreAuditDiffReport['manifest']['sections'];
  const statement = '本报告只陈述两份已验证恢复差异审计的结构化变化，不恢复工程，也不判断哪份恢复方案更优。';
  const evidence = { left: leftMetadata, right: rightMetadata, archiveMatch, summary, statement, sections, warnings, sectionManifest };
  const comparisonSha256 = (await digest(evidence)).sha256;
  return JSON.parse(JSON.stringify({ format: ARCHIVE_RESTORE_AUDIT_DIFF_FORMAT, version: ARCHIVE_RESTORE_AUDIT_DIFF_VERSION, id: `archive-restore-audit-diff-${comparisonSha256.slice(0, 16)}`, generatedAt: now.toISOString(), left: leftMetadata, right: rightMetadata, archiveMatch, summary, statement, sections, warnings, manifest: { algorithm: 'SHA-256', canonicalization: 'sorted-json-v1', sections: sectionManifest, comparisonSha256 } })) as ArchiveRestoreAuditDiffReport;
}

function escapeHtml(value: unknown) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!)); }

export function archiveRestoreAuditDiffToHtml(report: ArchiveRestoreAuditDiffReport) {
  const rows = Object.values(report.sections).map((section) => `<tr><td>${escapeHtml(section.label)}</td><td>${section.summary.added}</td><td>${section.summary.removed}</td><td>${section.summary.changed}</td><td>${section.summary.identical}</td></tr>`).join('');
  const embedded = JSON.stringify(report).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>归档恢复差异审计版本对比</title><style>body{font:14px/1.55 system-ui;margin:32px;color:#18202b}main{max-width:1100px;margin:auto}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd3df;padding:8px;text-align:left}code{word-break:break-all}</style></head><body><main><h1>归档恢复差异审计版本对比</h1><p>${escapeHtml(report.statement)}</p><p>左侧 ${escapeHtml(report.left.id)} · <code>${report.left.auditSha256}</code></p><p>右侧 ${escapeHtml(report.right.id)} · <code>${report.right.auditSha256}</code></p><table><thead><tr><th>类别</th><th>新增</th><th>移除</th><th>变化</th><th>相同</th></tr></thead><tbody>${rows}</tbody></table><p>比较 SHA-256：<code>${report.manifest.comparisonSha256}</code></p><script id="archive-restore-audit-diff-data" type="application/json">${embedded}</script></main></body></html>`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function unknownKeys(record: Record<string, unknown> | undefined, allowed: string[], path: string) { if (!record) return []; const known = new Set(allowed); return Object.keys(record).filter((key) => !known.has(key)).map((key) => `${path}${key}`); }
function arrayUnknownKeys(value: unknown, allowed: string[], path: string) { return Array.isArray(value) ? value.flatMap((item, index) => unknownKeys(asRecord(item), allowed, `${path}[${index}].`)) : []; }
function isSha256(value: unknown) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function isDiffSummary(value: unknown): value is Record<ArchiveRestoreAuditDiffStatus, number> {
  const summary = asRecord(value); return Boolean(summary && ['added', 'removed', 'changed', 'identical'].every((key) => Number.isInteger(summary[key]) && Number(summary[key]) >= 0));
}
function decodeHtmlJson(value: string) { return value.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10))).replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function extractAuditDiffJson(html: string) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const matches = scripts.filter((item) => /\bid\s*=\s*(["'])archive-restore-audit-diff-data\1/i.test(item[1]));
  if (matches.length !== 1) throw new Error(matches.length ? 'HTML 包含多个 archive-restore-audit-diff-data 数据块。' : 'HTML 缺少 archive-restore-audit-diff-data 数据块。');
  if (!/\btype\s*=\s*(["'])application\/json\1/i.test(matches[0][1])) throw new Error('恢复审计对比数据块不是 application/json 类型。');
  const decoded = decodeHtmlJson(matches[0][2].trim()); JSON.parse(decoded); return decoded;
}

export async function verifyArchiveRestoreAuditDiffText(text: string, fileType: 'json' | 'html'): Promise<ArchiveRestoreAuditDiffVerification> {
  const result: ArchiveRestoreAuditDiffVerification = { status: 'failed', fileType, unknownFields: [], errors: [], sections: [], comparison: { status: 'missing' } };
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) { result.errors.push('恢复审计版本对比文件超过 10 MB 安全上限。'); return result; }
  let parsed: unknown;
  try { parsed = JSON.parse(fileType === 'html' ? extractAuditDiffJson(text) : text); } catch (error) { result.errors.push(error instanceof Error ? error.message : '恢复审计版本对比不是合法 JSON。'); return result; }
  const root = asRecord(parsed); if (!root) { result.errors.push('恢复审计版本对比顶层必须是 JSON 对象。'); return result; }
  const left = asRecord(root.left); const right = asRecord(root.right); const archiveMatch = asRecord(root.archiveMatch); const summary = asRecord(root.summary); const sections = asRecord(root.sections); const manifest = asRecord(root.manifest); const manifestSections = asRecord(manifest?.sections);
  result.format = typeof root.format === 'string' ? root.format : undefined; result.version = typeof root.version === 'number' ? root.version : undefined; result.generatedAt = typeof root.generatedAt === 'string' ? root.generatedAt : undefined;
  const metadata = (value: Record<string, unknown> | undefined) => ({ id: typeof value?.id === 'string' ? value.id : undefined, archiveId: typeof value?.archiveId === 'string' ? value.archiveId : undefined, archiveVersion: typeof value?.archiveVersion === 'number' ? value.archiveVersion : undefined, disclosureMode: typeof value?.disclosureMode === 'string' ? value.disclosureMode : undefined, comparedAt: typeof value?.comparedAt === 'string' ? value.comparedAt : undefined, auditSha256: typeof value?.auditSha256 === 'string' ? value.auditSha256 : undefined });
  result.left = metadata(left); result.right = metadata(right); result.archiveMatch = { id: typeof archiveMatch?.id === 'boolean' ? archiveMatch.id : undefined, version: typeof archiveMatch?.version === 'boolean' ? archiveMatch.version : undefined, disclosureMode: typeof archiveMatch?.disclosureMode === 'boolean' ? archiveMatch.disclosureMode : undefined };
  const names: ArchiveRestoreAuditDiffSectionName[] = ['records', 'omissions', 'capacities', 'sources', 'findings'];
  const sectionValues = names.map((name) => [name, asRecord(sections?.[name])] as const);
  result.unknownFields = [
    ...unknownKeys(root, ['format', 'version', 'id', 'generatedAt', 'left', 'right', 'archiveMatch', 'summary', 'statement', 'sections', 'warnings', 'manifest'], ''),
    ...unknownKeys(left, ['id', 'archiveId', 'archiveVersion', 'disclosureMode', 'comparedAt', 'auditSha256'], 'left.'), ...unknownKeys(right, ['id', 'archiveId', 'archiveVersion', 'disclosureMode', 'comparedAt', 'auditSha256'], 'right.'),
    ...unknownKeys(archiveMatch, ['id', 'version', 'disclosureMode'], 'archiveMatch.'), ...unknownKeys(summary, ['added', 'removed', 'changed', 'identical'], 'summary.'), ...unknownKeys(sections, names, 'sections.'),
    ...sectionValues.flatMap(([name, section]) => [...unknownKeys(section, ['name', 'label', 'summary', 'items'], `sections.${name}.`), ...unknownKeys(asRecord(section?.summary), ['added', 'removed', 'changed', 'identical'], `sections.${name}.summary.`), ...arrayUnknownKeys(section?.items, ['id', 'status', 'leftSha256', 'rightSha256', 'changes'], `sections.${name}.items`), ...(Array.isArray(section?.items) ? section.items.flatMap((item, index) => arrayUnknownKeys(asRecord(item)?.changes, ['field', 'before', 'after'], `sections.${name}.items[${index}].changes`)) : [])]),
    ...unknownKeys(manifest, ['algorithm', 'canonicalization', 'sections', 'comparisonSha256'], 'manifest.'), ...unknownKeys(manifestSections, names, 'manifest.sections.'), ...Object.entries(manifestSections ?? {}).flatMap(([name, value]) => unknownKeys(asRecord(value), ['bytes', 'sha256'], `manifest.sections.${name}.`)),
  ].sort();
  let unsupported = false;
  if (root.format !== ARCHIVE_RESTORE_AUDIT_DIFF_FORMAT) { result.errors.push(`不支持的恢复审计对比格式：${String(root.format ?? '缺失')}。`); unsupported = true; }
  if (root.version !== ARCHIVE_RESTORE_AUDIT_DIFF_VERSION) { result.errors.push(`不支持的恢复审计对比版本：${String(root.version ?? '缺失')}。`); unsupported = true; }
  if (manifest?.algorithm !== 'SHA-256' || manifest?.canonicalization !== 'sorted-json-v1') { result.errors.push('不支持的哈希算法或 JSON 规范化规则。'); unsupported = true; }
  if (result.unknownFields.length) { result.errors.push(`存在未知关键字段：${result.unknownFields.join('、')}。`); unsupported = true; }
  if (typeof root.id !== 'string' || !root.id) result.errors.push('对比报告 ID 缺失或类型不正确。');
  if (typeof root.generatedAt !== 'string' || !Number.isFinite(Date.parse(root.generatedAt))) result.errors.push('生成时间缺失或格式不正确。');
  if (!left || !right || [left, right].some((side) => typeof side.id !== 'string' || !side.id || typeof side.archiveId !== 'string' || !side.archiveId || !Number.isInteger(side.archiveVersion) || Number(side.archiveVersion) < 1 || typeof side.disclosureMode !== 'string' || !side.disclosureMode || typeof side.comparedAt !== 'string' || !Number.isFinite(Date.parse(String(side.comparedAt))) || !isSha256(side.auditSha256))) result.errors.push('左右审计或归档元数据缺失或格式不正确。');
  if (!archiveMatch || ['id', 'version', 'disclosureMode'].some((key) => typeof archiveMatch[key] !== 'boolean') || typeof root.statement !== 'string' || !root.statement || !Array.isArray(root.warnings) || root.warnings.some((item) => typeof item !== 'string') || !isDiffSummary(root.summary)) result.errors.push('归档匹配状态、总摘要、对比声明或警告结构缺失或格式不正确。');
  if (left && right && archiveMatch && (archiveMatch.id !== (left.archiveId === right.archiveId) || archiveMatch.version !== (left.archiveVersion === right.archiveVersion) || archiveMatch.disclosureMode !== (left.disclosureMode === right.disclosureMode))) result.errors.push('归档匹配状态与左右归档元数据不一致。');
  const aggregate = { added: 0, removed: 0, changed: 0, identical: 0 };
  for (const name of names) {
    const value = sections?.[name]; const section = asRecord(value); const expected = asRecord(manifestSections?.[name]);
    if (value === undefined || !expected) { result.sections.push({ name, status: 'missing' }); result.errors.push(`${name} 数据段或清单缺失。`); continue; }
    const items = Array.isArray(section?.items) ? section.items : [];
    const itemStructureValid = items.every((item) => {
      const record = asRecord(item); const status = record?.status; const itemChanges = record?.changes;
      return Boolean(record && typeof record.id === 'string' && record.id && ['added', 'removed', 'changed', 'identical'].includes(String(status)) &&
        (record.leftSha256 === undefined || isSha256(record.leftSha256)) && (record.rightSha256 === undefined || isSha256(record.rightSha256)) &&
        Array.isArray(itemChanges) && itemChanges.every((change) => typeof asRecord(change)?.field === 'string') &&
        (status === 'added' ? record.leftSha256 === undefined && isSha256(record.rightSha256) : status === 'removed' ? isSha256(record.leftSha256) && record.rightSha256 === undefined : isSha256(record.leftSha256) && isSha256(record.rightSha256)));
    });
    const itemSummary = { added: 0, removed: 0, changed: 0, identical: 0 };
    if (itemStructureValid) items.forEach((item) => { itemSummary[(asRecord(item)!.status as ArchiveRestoreAuditDiffStatus)] += 1; });
    const structureValid = Boolean(section && section.name === name && typeof section.label === 'string' && section.label && isDiffSummary(section.summary) && itemStructureValid && Number.isInteger(expected.bytes) && Number(expected.bytes) >= 0 && isSha256(expected.sha256));
    if (!structureValid) { result.sections.push({ name, status: 'unsupported' }); result.errors.push(`${name} 数据段或清单结构不受支持。`); unsupported = true; continue; }
    if (canonicalize(section!.summary) !== canonicalize(itemSummary)) result.errors.push(`${name} 摘要与逐项计数不一致。`);
    (Object.keys(aggregate) as ArchiveRestoreAuditDiffStatus[]).forEach((status) => { aggregate[status] += itemSummary[status]; });
    const expectedBytes = expected.bytes as number; const expectedSha256 = expected.sha256 as string;
    const actual = await digest(value); const verified = expectedBytes === actual.bytes && expectedSha256 === actual.sha256;
    result.sections.push({ name, status: verified ? 'verified' : 'tampered', expectedBytes, actualBytes: actual.bytes, expectedSha256, actualSha256: actual.sha256 }); if (!verified) result.errors.push(`${name} 数据段与清单不一致。`);
  }
  if (isDiffSummary(root.summary) && canonicalize(root.summary) !== canonicalize(aggregate)) result.errors.push('总摘要与五个数据段的逐项计数不一致。');
  const expectedComparison = typeof manifest?.comparisonSha256 === 'string' ? manifest.comparisonSha256 : undefined;
  const actualComparison = await digest({ left: root.left, right: root.right, archiveMatch: root.archiveMatch, summary: root.summary, statement: root.statement, sections: root.sections, warnings: root.warnings, sectionManifest: manifestSections });
  result.comparison = { status: !expectedComparison ? 'missing' : expectedComparison === actualComparison.sha256 ? 'verified' : 'tampered', expectedSha256: expectedComparison, actualSha256: actualComparison.sha256 };
  if (!expectedComparison) result.errors.push('整份恢复审计对比 SHA-256 缺失。'); else if (expectedComparison !== actualComparison.sha256) result.errors.push('整份恢复审计对比 SHA-256 与实际数据不一致。');
  if (typeof root.id === 'string' && root.id !== `archive-restore-audit-diff-${actualComparison.sha256.slice(0, 16)}`) result.errors.push('对比报告 ID 与实际总 SHA-256 不一致。');
  result.status = unsupported ? 'unsupported' : result.errors.length ? 'failed' : 'verified'; return result;
}

export function archiveRestoreAuditDiffFileType(fileName: string, mimeType = ''): 'json' | 'html' {
  if (/\.html?$/i.test(fileName) || /text\/html/i.test(mimeType)) return 'html'; if (/\.json$/i.test(fileName) || /application\/json/i.test(mimeType)) return 'json'; throw new Error('只支持恢复审计版本对比 .json、.html 或 .htm 文件。');
}
