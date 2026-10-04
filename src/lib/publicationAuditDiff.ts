import { verifyPublicationAuditText, type PublicationAuditReport } from '@/lib/publicationAuditReport';

export const PUBLICATION_AUDIT_DIFF_FORMAT = 'hyperframes-publication-audit-diff' as const;
export const PUBLICATION_AUDIT_DIFF_VERSION = 1 as const;

export type PublicationAuditDiffStatus = 'added' | 'removed' | 'changed' | 'identical';
export type PublicationAuditDiffSectionName = 'lineageNodes' | 'lineageEdges' | 'batchSessions' | 'batchRollbacks' | 'issues';

export interface PublicationAuditFieldChange {
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface PublicationAuditDiffItem {
  id: string;
  status: PublicationAuditDiffStatus;
  leftSha256?: string;
  rightSha256?: string;
  changes: PublicationAuditFieldChange[];
}

export interface PublicationAuditDiffSection {
  name: PublicationAuditDiffSectionName;
  label: string;
  summary: Record<PublicationAuditDiffStatus, number>;
  items: PublicationAuditDiffItem[];
}

export interface PublicationAuditDiffReport {
  format: typeof PUBLICATION_AUDIT_DIFF_FORMAT;
  version: typeof PUBLICATION_AUDIT_DIFF_VERSION;
  id: string;
  generatedAt: string;
  left: { id: string; scope: string; generatedAt: string; evidenceSha256: string };
  right: { id: string; scope: string; generatedAt: string; evidenceSha256: string };
  scopeMatch: boolean;
  summary: Record<PublicationAuditDiffStatus, number>;
  statement: string;
  sections: Record<PublicationAuditDiffSectionName, PublicationAuditDiffSection>;
  warnings: string[];
  manifest: {
    algorithm: 'SHA-256';
    canonicalization: 'sorted-json-v1';
    sections: Record<PublicationAuditDiffSectionName, { bytes: number; sha256: string }>;
    comparisonSha256: string;
  };
}

export interface PublicationAuditDiffVerification {
  status: 'verified' | 'failed' | 'unsupported';
  fileType: 'json' | 'html';
  format?: string;
  version?: number;
  generatedAt?: string;
  left?: { id?: string; scope?: string; evidenceSha256?: string };
  right?: { id?: string; scope?: string; evidenceSha256?: string };
  scopeMatch?: boolean;
  unknownFields: string[];
  errors: string[];
  sections: Array<{ name: PublicationAuditDiffSectionName; status: 'verified' | 'tampered' | 'missing' | 'unsupported'; expectedBytes?: number; actualBytes?: number; expectedSha256?: string; actualSha256?: string }>;
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

function same(left: unknown, right: unknown) { return canonicalize(left) === canonicalize(right); }

function fieldChanges(left: unknown, right: unknown, path = ''): PublicationAuditFieldChange[] {
  if (same(left, right)) return [];
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    return keys.flatMap((key) => fieldChanges(leftRecord[key], rightRecord[key], path ? `${path}.${key}` : key));
  }
  return [{ field: path || '$', ...(left !== undefined ? { before: structuredClone(left) } : {}), ...(right !== undefined ? { after: structuredClone(right) } : {}) }];
}

async function compareItems(label: string, name: PublicationAuditDiffSectionName, left: Map<string, unknown>, right: Map<string, unknown>): Promise<PublicationAuditDiffSection> {
  const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
  const items = await Promise.all(ids.map(async (id): Promise<PublicationAuditDiffItem> => {
    const before = left.get(id); const after = right.get(id);
    const [leftDigest, rightDigest] = await Promise.all([before === undefined ? undefined : digest(before), after === undefined ? undefined : digest(after)]);
    const status: PublicationAuditDiffStatus = before === undefined ? 'added' : after === undefined ? 'removed' : leftDigest?.sha256 === rightDigest?.sha256 ? 'identical' : 'changed';
    return {
      id, status,
      ...(leftDigest ? { leftSha256: leftDigest.sha256 } : {}),
      ...(rightDigest ? { rightSha256: rightDigest.sha256 } : {}),
      changes: status === 'changed' ? fieldChanges(before, after) : [],
    };
  }));
  const summary = { added: 0, removed: 0, changed: 0, identical: 0 };
  items.forEach((item) => { summary[item.status] += 1; });
  return { name, label, summary, items };
}

function edges(report: PublicationAuditReport) {
  return new Map(report.sections.lineage.edges.map((item) => [`${item.from}\u0000${item.to}\u0000${item.label}`, item]));
}

function issues(report: PublicationAuditReport) {
  return new Map(Object.entries(report.issues).map(([kind, entries]) => [kind, [...entries].sort()]));
}

async function assertVerified(report: PublicationAuditReport, side: string) {
  const verification = await verifyPublicationAuditText(JSON.stringify(report), 'json');
  if (verification.status !== 'verified') throw new Error(`${side}报告未通过独立验证，不能比较：${verification.errors.join('；')}`);
}

export async function createPublicationAuditDiff(left: PublicationAuditReport, right: PublicationAuditReport, now = new Date()): Promise<PublicationAuditDiffReport> {
  await Promise.all([assertVerified(left, '左侧'), assertVerified(right, '右侧')]);
  const sectionList = await Promise.all([
    compareItems('血缘节点', 'lineageNodes', new Map(left.sections.lineage.nodes.map((item) => [item.id, item])), new Map(right.sections.lineage.nodes.map((item) => [item.id, item]))),
    compareItems('血缘关系', 'lineageEdges', edges(left), edges(right)),
    compareItems('批次会话', 'batchSessions', new Map(left.sections.batchSessions.map((item) => [item.id, item])), new Map(right.sections.batchSessions.map((item) => [item.id, item]))),
    compareItems('回滚回执', 'batchRollbacks', new Map(left.sections.batchRollbacks.map((item) => [item.id, item])), new Map(right.sections.batchRollbacks.map((item) => [item.id, item]))),
    compareItems('异常分类', 'issues', issues(left), issues(right)),
  ]);
  const sections = Object.fromEntries(sectionList.map((section) => [section.name, section])) as PublicationAuditDiffReport['sections'];
  const summary = { added: 0, removed: 0, changed: 0, identical: 0 };
  sectionList.forEach((section) => (Object.keys(summary) as PublicationAuditDiffStatus[]).forEach((status) => { summary[status] += section.summary[status]; }));
  const leftMetadata = { id: left.id, scope: left.scope, generatedAt: left.generatedAt, evidenceSha256: left.manifest.evidenceSha256 };
  const rightMetadata = { id: right.id, scope: right.scope, generatedAt: right.generatedAt, evidenceSha256: right.manifest.evidenceSha256 };
  const scopeMatch = left.scope === right.scope;
  const warnings = scopeMatch ? [] : ['两份报告的审计范围不同；差异可能来自范围变化。'];
  const manifestEntries = await Promise.all(sectionList.map(async (section) => [section.name, await digest(section)] as const));
  const sectionManifest = Object.fromEntries(manifestEntries) as PublicationAuditDiffReport['manifest']['sections'];
  const evidence = { left: leftMetadata, right: rightMetadata, scopeMatch, summary, statement: '本报告仅陈述两份已验证证据报告的结构化变化，不推断因果，也不判定哪个版本更优。', sections, warnings, sectionManifest };
  const comparisonSha256 = (await digest(evidence)).sha256;
  return {
    format: PUBLICATION_AUDIT_DIFF_FORMAT,
    version: PUBLICATION_AUDIT_DIFF_VERSION,
    id: `publication-audit-diff-${comparisonSha256.slice(0, 16)}`,
    generatedAt: now.toISOString(),
    left: leftMetadata,
    right: rightMetadata,
    scopeMatch,
    summary,
    statement: evidence.statement,
    sections,
    warnings,
    manifest: { algorithm: 'SHA-256', canonicalization: 'sorted-json-v1', sections: sectionManifest, comparisonSha256 },
  };
}

function htmlEscape(value: unknown) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

export function publicationAuditDiffToHtml(report: PublicationAuditDiffReport) {
  const rows = Object.values(report.sections).map((section) => `<tr><td>${htmlEscape(section.label)}</td><td>${section.summary.added}</td><td>${section.summary.removed}</td><td>${section.summary.changed}</td><td>${section.summary.identical}</td></tr>`).join('');
  const changed = Object.values(report.sections).flatMap((section) => section.items.filter((item) => item.status !== 'identical').map((item) => `<li><b>${htmlEscape(section.label)}</b> ${htmlEscape(item.id)} · ${htmlEscape(item.status)}${item.changes.length ? `<ul>${item.changes.map((change) => `<li>${htmlEscape(change.field)}</li>`).join('')}</ul>` : ''}</li>`)).join('') || '<li>两份报告内容相同。</li>';
  const embedded = JSON.stringify(report).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>发布证据审计版本差异</title><style>body{font:14px/1.55 system-ui;margin:32px;color:#18202b;background:#f6f8fb}main{max-width:1100px;margin:auto;background:white;padding:28px;border-radius:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d8dee8;padding:8px;text-align:left}code{word-break:break-all}</style></head><body><main><h1>发布证据审计版本差异</h1><p>${htmlEscape(report.statement)}</p><p>左侧 ${htmlEscape(report.left.id)} · ${htmlEscape(report.left.scope)} · <code>${report.left.evidenceSha256}</code></p><p>右侧 ${htmlEscape(report.right.id)} · ${htmlEscape(report.right.scope)} · <code>${report.right.evidenceSha256}</code></p><table><thead><tr><th>类别</th><th>新增</th><th>移除</th><th>变化</th><th>相同</th></tr></thead><tbody>${rows}</tbody></table><h2>变化项</h2><ul>${changed}</ul><p>差异 SHA-256：<code>${report.manifest.comparisonSha256}</code></p><script id="publication-audit-diff-data" type="application/json">${embedded}</script></main></body></html>`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unknownKeys(record: Record<string, unknown> | undefined, allowed: string[], path: string) {
  if (!record) return [];
  const known = new Set(allowed);
  return Object.keys(record).filter((key) => !known.has(key)).map((key) => `${path}${key}`);
}

function arrayUnknownKeys(value: unknown, allowed: string[], path: string) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => unknownKeys(asRecord(item), allowed, `${path}[${index}].`));
}

function decodeHtmlJson(value: string) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function extractPublicationAuditDiffJson(html: string) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const matches = scripts.filter((item) => /\bid\s*=\s*(["'])publication-audit-diff-data\1/i.test(item[1]));
  if (matches.length !== 1) throw new Error(matches.length ? 'HTML 包含多个 publication-audit-diff-data 数据块。' : 'HTML 缺少 publication-audit-diff-data 数据块。');
  if (!/\btype\s*=\s*(["'])application\/json\1/i.test(matches[0][1])) throw new Error('版本差异数据块不是 application/json 类型。');
  const decoded = decodeHtmlJson(matches[0][2].trim());
  JSON.parse(decoded);
  return decoded;
}

export async function verifyPublicationAuditDiffText(text: string, fileType: 'json' | 'html'): Promise<PublicationAuditDiffVerification> {
  const result: PublicationAuditDiffVerification = { status: 'failed', fileType, unknownFields: [], errors: [], sections: [], comparison: { status: 'missing' } };
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) { result.errors.push('版本差异文件超过 10 MB 安全上限。'); return result; }
  let parsed: unknown;
  try { parsed = JSON.parse(fileType === 'html' ? extractPublicationAuditDiffJson(text) : text); }
  catch (error) { result.errors.push(error instanceof Error ? error.message : '版本差异不是合法 JSON。'); return result; }
  const root = asRecord(parsed);
  if (!root) { result.errors.push('版本差异顶层必须是 JSON 对象。'); return result; }
  const left = asRecord(root.left); const right = asRecord(root.right); const summary = asRecord(root.summary); const sections = asRecord(root.sections);
  const manifest = asRecord(root.manifest); const manifestSections = asRecord(manifest?.sections);
  result.format = typeof root.format === 'string' ? root.format : undefined;
  result.version = typeof root.version === 'number' ? root.version : undefined;
  result.generatedAt = typeof root.generatedAt === 'string' ? root.generatedAt : undefined;
  result.left = { id: typeof left?.id === 'string' ? left.id : undefined, scope: typeof left?.scope === 'string' ? left.scope : undefined, evidenceSha256: typeof left?.evidenceSha256 === 'string' ? left.evidenceSha256 : undefined };
  result.right = { id: typeof right?.id === 'string' ? right.id : undefined, scope: typeof right?.scope === 'string' ? right.scope : undefined, evidenceSha256: typeof right?.evidenceSha256 === 'string' ? right.evidenceSha256 : undefined };
  result.scopeMatch = typeof root.scopeMatch === 'boolean' ? root.scopeMatch : undefined;
  const names: PublicationAuditDiffSectionName[] = ['lineageNodes', 'lineageEdges', 'batchSessions', 'batchRollbacks', 'issues'];
  const sectionValues = names.map((name) => [name, asRecord(sections?.[name])] as const);
  result.unknownFields = [
    ...unknownKeys(root, ['format', 'version', 'id', 'generatedAt', 'left', 'right', 'scopeMatch', 'summary', 'statement', 'sections', 'warnings', 'manifest'], ''),
    ...unknownKeys(left, ['id', 'scope', 'generatedAt', 'evidenceSha256'], 'left.'),
    ...unknownKeys(right, ['id', 'scope', 'generatedAt', 'evidenceSha256'], 'right.'),
    ...unknownKeys(summary, ['added', 'removed', 'changed', 'identical'], 'summary.'),
    ...unknownKeys(sections, names, 'sections.'),
    ...sectionValues.flatMap(([name, section]) => [
      ...unknownKeys(section, ['name', 'label', 'summary', 'items'], `sections.${name}.`),
      ...unknownKeys(asRecord(section?.summary), ['added', 'removed', 'changed', 'identical'], `sections.${name}.summary.`),
      ...arrayUnknownKeys(section?.items, ['id', 'status', 'leftSha256', 'rightSha256', 'changes'], `sections.${name}.items`),
      ...(Array.isArray(section?.items) ? section.items.flatMap((item, index) => arrayUnknownKeys(asRecord(item)?.changes, ['field', 'before', 'after'], `sections.${name}.items[${index}].changes`)) : []),
    ]),
    ...unknownKeys(manifest, ['algorithm', 'canonicalization', 'sections', 'comparisonSha256'], 'manifest.'),
    ...unknownKeys(manifestSections, names, 'manifest.sections.'),
    ...Object.entries(manifestSections ?? {}).flatMap(([name, value]) => unknownKeys(asRecord(value), ['bytes', 'sha256'], `manifest.sections.${name}.`)),
  ].sort();
  let unsupported = false;
  if (root.format !== PUBLICATION_AUDIT_DIFF_FORMAT) { result.errors.push(`不支持的版本差异格式：${String(root.format ?? '缺失')}。`); unsupported = true; }
  if (root.version !== PUBLICATION_AUDIT_DIFF_VERSION) { result.errors.push(`不支持的版本差异版本：${String(root.version ?? '缺失')}。`); unsupported = true; }
  if (manifest?.algorithm !== 'SHA-256' || manifest?.canonicalization !== 'sorted-json-v1') { result.errors.push('不支持的哈希算法或 JSON 规范化规则。'); unsupported = true; }
  if (result.unknownFields.length) { result.errors.push(`存在未知关键字段：${result.unknownFields.join('、')}。`); unsupported = true; }
  if (typeof root.id !== 'string' || !root.id) result.errors.push('差异报告 ID 缺失或类型不正确。');
  if (typeof root.generatedAt !== 'string' || !Number.isFinite(Date.parse(root.generatedAt))) result.errors.push('生成时间缺失或格式不正确。');
  if (!left || !right || [left, right].some((side) => typeof side.id !== 'string' || typeof side.scope !== 'string' || typeof side.generatedAt !== 'string' || typeof side.evidenceSha256 !== 'string')) result.errors.push('左右报告 ID、范围、生成时间或证据 SHA-256 缺失。');
  if (typeof root.scopeMatch !== 'boolean' || typeof root.statement !== 'string' || !Array.isArray(root.warnings)) result.errors.push('范围一致性、差异声明或警告结构缺失。');
  for (const name of names) {
    const value = sections?.[name]; const section = asRecord(value); const expected = asRecord(manifestSections?.[name]);
    if (value === undefined || !expected) {
      result.sections.push({ name, status: 'missing', expectedBytes: typeof expected?.bytes === 'number' ? expected.bytes : undefined, expectedSha256: typeof expected?.sha256 === 'string' ? expected.sha256 : undefined });
      result.errors.push(`${name} 数据段或清单缺失。`); continue;
    }
    if (!section || section.name !== name || !Array.isArray(section.items) || typeof expected.bytes !== 'number' || typeof expected.sha256 !== 'string') {
      result.sections.push({ name, status: 'unsupported' }); result.errors.push(`${name} 数据段或清单结构不受支持。`); unsupported = true; continue;
    }
    const actual = await digest(value);
    const verified = expected.bytes === actual.bytes && expected.sha256 === actual.sha256;
    result.sections.push({ name, status: verified ? 'verified' : 'tampered', expectedBytes: expected.bytes, actualBytes: actual.bytes, expectedSha256: expected.sha256, actualSha256: actual.sha256 });
    if (!verified) result.errors.push(`${name} 数据段与清单不一致。`);
  }
  const expectedComparison = typeof manifest?.comparisonSha256 === 'string' ? manifest.comparisonSha256 : undefined;
  const actualComparison = await digest({ left: root.left, right: root.right, scopeMatch: root.scopeMatch, summary: root.summary, statement: root.statement, sections: root.sections, warnings: root.warnings, sectionManifest: manifestSections });
  result.comparison = { status: !expectedComparison ? 'missing' : expectedComparison === actualComparison.sha256 ? 'verified' : 'tampered', expectedSha256: expectedComparison, actualSha256: actualComparison.sha256 };
  if (!expectedComparison) result.errors.push('整份版本差异 SHA-256 缺失。');
  else if (expectedComparison !== actualComparison.sha256) result.errors.push('整份版本差异 SHA-256 与实际数据不一致。');
  if (typeof root.id === 'string' && root.id !== `publication-audit-diff-${actualComparison.sha256.slice(0, 16)}`) result.errors.push('差异报告 ID 与实际总 SHA-256 不一致。');
  result.status = unsupported ? 'unsupported' : result.errors.length ? 'failed' : 'verified';
  return result;
}

export function publicationAuditDiffFileType(fileName: string, mimeType = ''): 'json' | 'html' {
  if (/\.html?$/i.test(fileName) || /text\/html/i.test(mimeType)) return 'html';
  if (/\.json$/i.test(fileName) || /application\/json/i.test(mimeType)) return 'json';
  throw new Error('只支持版本差异 .json、.html 或 .htm 文件。');
}
