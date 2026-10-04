import type { ExistingArchiveCollections, ProjectArchiveRestorePreview } from '@/lib/projectArchive';

export const ARCHIVE_RESTORE_AUDIT_FORMAT = 'hyperframes-archive-restore-diff-audit' as const;
export const ARCHIVE_RESTORE_AUDIT_VERSION = 1 as const;

export type ArchiveRestoreCollectionName = keyof ExistingArchiveCollections;
export type ArchiveRestoreItemStatus = 'new' | 'identical' | 'conflict';
export type ArchiveRestoreSourceStatus = 'verified' | 'available-unverified' | 'missing' | 'changed' | 'pending-relocation';

export interface ArchiveRestoreAuditItem {
  id: string;
  status: ArchiveRestoreItemStatus;
  incomingSha256: string;
  existingSha256?: string;
  incomingSummary: Record<string, unknown>;
  existingSummary?: Record<string, unknown>;
}

export interface ArchiveRestoreAuditCollection {
  name: ArchiveRestoreCollectionName;
  label: string;
  limit: number;
  current: number;
  incoming: number;
  newCount: number;
  identicalCount: number;
  conflictCount: number;
  merged: number;
  capacityStatus: 'within-limit' | 'over-limit';
  items: ArchiveRestoreAuditItem[];
}

export interface ArchiveRestoreAuditReport {
  format: typeof ARCHIVE_RESTORE_AUDIT_FORMAT;
  version: typeof ARCHIVE_RESTORE_AUDIT_VERSION;
  id: string;
  comparedAt: string;
  archive: {
    id: string;
    version: number;
    projectName: string;
    createdAt: string;
    disclosureMode: 'legacy-full' | 'minimal' | 'custom' | 'full';
  };
  summary: {
    newRecords: number;
    identicalRecords: number;
    conflicts: number;
    intentionallyOmittedRecords: number;
    capacityRisks: number;
    sourceStatuses: Record<ArchiveRestoreSourceStatus, number>;
  };
  sections: {
    collections: ArchiveRestoreAuditCollection[];
    omissions: Array<{ collection: ArchiveRestoreCollectionName; label: string; count: number; reason: string }>;
    disclosureDomains: string[];
    capacities: Array<{ collection: ArchiveRestoreCollectionName; label: string; current: number; incomingNew: number; merged: number; limit: number; status: 'within-limit' | 'over-limit' }>;
    sources: Array<{ id: string; name: string; path: string; status: ArchiveRestoreSourceStatus; expectedSize: number; duration: number; quickSha256?: string }>;
    findings: { blockers: string[]; warnings: string[] };
  };
  manifest: {
    algorithm: 'SHA-256';
    canonicalization: 'sorted-json-v1';
    sections: Record<'collections' | 'omissions' | 'disclosureDomains' | 'capacities' | 'sources' | 'findings', { bytes: number; sha256: string }>;
    auditSha256: string;
  };
}

export type ArchiveRestoreAuditSectionName = 'collections' | 'omissions' | 'disclosureDomains' | 'capacities' | 'sources' | 'findings';
export interface ArchiveRestoreAuditVerification {
  status: 'verified' | 'failed' | 'unsupported';
  fileType: 'json' | 'html';
  format?: string;
  version?: number;
  archiveId?: string;
  archiveVersion?: number;
  disclosureMode?: string;
  comparedAt?: string;
  unknownFields: string[];
  errors: string[];
  sections: Array<{ name: ArchiveRestoreAuditSectionName; status: 'verified' | 'tampered' | 'missing' | 'unsupported'; expectedBytes?: number; actualBytes?: number; expectedSha256?: string; actualSha256?: string }>;
  audit: { status: 'verified' | 'tampered' | 'missing'; expectedSha256?: string; actualSha256?: string };
}

const definitions: Array<{ name: ArchiveRestoreCollectionName; label: string; limit: number }> = [
  { name: 'releaseCandidates', label: 'RC', limit: 12 },
  { name: 'postPublishObservations', label: '发布观察', limit: 100 },
  { name: 'postPublishExperiments', label: '实验', limit: 50 },
  { name: 'directorLearning', label: '导演学习', limit: 300 },
  { name: 'postPublishBatchSessions', label: '批次会话', limit: 100 },
  { name: 'postPublishBatchRollbacks', label: '回滚回执', limit: 100 },
];

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

function summary(name: ArchiveRestoreCollectionName, value: Record<string, any>): Record<string, unknown> {
  switch (name) {
    case 'releaseCandidates': return { label: value.label, projectName: value.projectName, createdAt: value.createdAt, renderSha256: value.render?.sha256 };
    case 'postPublishObservations': return { platform: value.source?.platform, accountLabel: value.source?.accountLabel, contentId: value.source?.postUrl, rcId: value.rcId, observedAt: value.observedAt, renderSha256: value.renderSha256 };
    case 'postPublishExperiments': return { conclusion: value.conclusion, confirmedAt: value.confirmedAt, leftObservationId: value.leftObservationId, rightObservationId: value.rightObservationId };
    case 'directorLearning': return { sourceKind: value.sourceKind, category: value.category, summary: value.summary, sourceConfirmedAt: value.provenance?.sourceConfirmedAt };
    case 'postPublishBatchSessions': return { sourceFileName: value.sourceFileName, sourceFileSha256: value.sourceFileSha256, format: value.format, confirmedAt: value.confirmedAt, rowCount: value.rows?.length ?? 0 };
    case 'postPublishBatchRollbacks': return { sessionId: value.sessionId, rolledBackAt: value.rolledBackAt, reason: value.reason, observationCount: value.observationIds?.length ?? 0 };
  }
}

export async function createArchiveRestoreAudit(
  preview: ProjectArchiveRestorePreview,
  existing: ExistingArchiveCollections,
  now = new Date(),
  pendingRelocationSourceIds: string[] = [],
): Promise<ArchiveRestoreAuditReport> {
  if (preview.integrity !== 'verified') throw new Error('归档完整性未通过，不能生成或导出恢复差异审计。');
  const collections: ArchiveRestoreAuditCollection[] = [];
  for (const definition of definitions) {
    const incoming = (preview.archive.sections[definition.name] ?? []) as Array<Record<string, any>>;
    const local = existing[definition.name] as Array<Record<string, any>>;
    const localById = new Map(local.map((item) => [item.id, item]));
    const items: ArchiveRestoreAuditItem[] = [];
    for (const item of incoming) {
      const localItem = localById.get(item.id);
      const [incomingDigest, existingDigest] = await Promise.all([digest(item), localItem ? digest(localItem) : undefined]);
      const status: ArchiveRestoreItemStatus = !localItem ? 'new' : incomingDigest.sha256 === existingDigest?.sha256 ? 'identical' : 'conflict';
      items.push({
        id: item.id,
        status,
        incomingSha256: incomingDigest.sha256,
        ...(existingDigest ? { existingSha256: existingDigest.sha256 } : {}),
        incomingSummary: summary(definition.name, item),
        ...(localItem ? { existingSummary: summary(definition.name, localItem) } : {}),
      });
    }
    items.sort((left, right) => left.id.localeCompare(right.id));
    const newCount = items.filter((item) => item.status === 'new').length;
    const merged = local.length + newCount;
    collections.push({
      ...definition,
      current: local.length,
      incoming: incoming.length,
      newCount,
      identicalCount: items.filter((item) => item.status === 'identical').length,
      conflictCount: items.filter((item) => item.status === 'conflict').length,
      merged,
      capacityStatus: merged > definition.limit ? 'over-limit' : 'within-limit',
      items,
    });
  }

  const disclosure = preview.archive.version === 3 ? preview.archive.disclosure : undefined;
  const omissions = definitions.flatMap((definition) => {
    const count = disclosure?.excluded[definition.name] ?? 0;
    return count > 0 ? [{ collection: definition.name, label: definition.label, count, reason: 'v3 披露策略主动省略' }] : [];
  });
  const pending = new Set(pendingRelocationSourceIds);
  const sources = preview.sourceResults.map((source) => ({
    id: source.id,
    name: source.name,
    path: source.path,
    status: pending.has(source.id) ? 'pending-relocation' as const : source.restoreStatus,
    expectedSize: source.expectedSize,
    duration: source.duration,
    ...(source.quickSha256 ? { quickSha256: source.quickSha256 } : {}),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const capacities = collections.map((item) => ({ collection: item.name, label: item.label, current: item.current, incomingNew: item.newCount, merged: item.merged, limit: item.limit, status: item.capacityStatus }));
  const capacityWarnings = capacities.filter((item) => item.status === 'over-limit').map((item) => `${item.label} 合并后 ${item.merged} 条，超过安全上限 ${item.limit}。`);
  const findings = {
    blockers: [...new Set([...preview.blockers, ...capacityWarnings])].sort(),
    warnings: [...new Set(preview.warnings)].sort(),
  };
  const sourceStatuses: Record<ArchiveRestoreSourceStatus, number> = { verified: 0, 'available-unverified': 0, missing: 0, changed: 0, 'pending-relocation': 0 };
  sources.forEach((item) => { sourceStatuses[item.status] += 1; });
  const sections = { collections, omissions, disclosureDomains: [...(disclosure?.omittedDomains ?? [])].sort(), capacities, sources, findings };
  const sectionEntries = await Promise.all((Object.keys(sections) as Array<keyof typeof sections>).map(async (name) => [name, await digest(sections[name])] as const));
  const sectionManifest = Object.fromEntries(sectionEntries) as ArchiveRestoreAuditReport['manifest']['sections'];
  const comparedAt = now.toISOString();
  const archive = {
    id: preview.archive.id,
    version: preview.archive.version,
    projectName: preview.archive.projectName,
    createdAt: preview.archive.createdAt,
    disclosureMode: disclosure?.mode ?? 'legacy-full' as const,
  };
  const summaryValue = {
    newRecords: collections.reduce((sum, item) => sum + item.newCount, 0),
    identicalRecords: collections.reduce((sum, item) => sum + item.identicalCount, 0),
    conflicts: collections.reduce((sum, item) => sum + item.conflictCount, 0),
    intentionallyOmittedRecords: omissions.reduce((sum, item) => sum + item.count, 0),
    capacityRisks: capacities.filter((item) => item.status === 'over-limit').length,
    sourceStatuses,
  };
  const idSeed = { archive, comparedAt, summary: summaryValue, sections, sectionManifest };
  const auditSha256 = (await digest(idSeed)).sha256;
  return {
    format: ARCHIVE_RESTORE_AUDIT_FORMAT,
    version: ARCHIVE_RESTORE_AUDIT_VERSION,
    id: `restore-audit-${auditSha256.slice(0, 16)}`,
    comparedAt,
    archive,
    summary: summaryValue,
    sections,
    manifest: { algorithm: 'SHA-256', canonicalization: 'sorted-json-v1', sections: sectionManifest, auditSha256 },
  };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function archiveRestoreAuditToHtml(report: ArchiveRestoreAuditReport) {
  const embedded = JSON.stringify(report).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const collectionRows = report.sections.collections.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${item.newCount}</td><td>${item.identicalCount}</td><td>${item.conflictCount}</td><td>${item.merged} / ${item.limit}</td></tr>`).join('');
  const sourceRows = report.sections.sources.map((item) => `<li>${escapeHtml(item.name)} · ${escapeHtml(item.status)} · ${escapeHtml(item.path)}</li>`).join('') || '<li>无外部素材引用</li>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>归档恢复差异审计</title><style>body{font:14px/1.6 system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#172033}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3df;padding:8px;text-align:left}code{word-break:break-all}section{margin:24px 0}</style></head><body><h1>归档恢复差异审计</h1><p>${escapeHtml(report.archive.projectName)} · 归档 v${report.archive.version} · ${escapeHtml(report.archive.disclosureMode)}</p><p>比较时间：${escapeHtml(report.comparedAt)}</p><section><h2>记录差异</h2><table><thead><tr><th>类别</th><th>新增</th><th>相同</th><th>冲突</th><th>合并容量</th></tr></thead><tbody>${collectionRows}</tbody></table></section><section><h2>素材引用</h2><ul>${sourceRows}</ul></section><section><h2>校验</h2><p>整体 SHA-256：<code>${report.manifest.auditSha256}</code></p></section><script id="archive-restore-audit-data" type="application/json">${embedded}</script></body></html>`;
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

function extractRestoreAuditJsonFromHtml(html: string) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const matches = scripts.filter((item) => /\bid\s*=\s*(["'])archive-restore-audit-data\1/i.test(item[1]));
  if (matches.length !== 1) throw new Error(matches.length ? 'HTML 包含多个 archive-restore-audit-data 数据块。' : 'HTML 缺少 archive-restore-audit-data 数据块。');
  if (!/\btype\s*=\s*(["'])application\/json\1/i.test(matches[0][1])) throw new Error('恢复差异审计数据块不是 application/json 类型。');
  const decoded = decodeHtmlJson(matches[0][2].trim());
  JSON.parse(decoded);
  return decoded;
}

export async function verifyArchiveRestoreAuditText(text: string, fileType: 'json' | 'html'): Promise<ArchiveRestoreAuditVerification> {
  const result: ArchiveRestoreAuditVerification = { status: 'failed', fileType, unknownFields: [], errors: [], sections: [], audit: { status: 'missing' } };
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) { result.errors.push('恢复差异审计文件超过 10 MB 安全上限。'); return result; }
  let parsed: unknown;
  try { parsed = JSON.parse(fileType === 'html' ? extractRestoreAuditJsonFromHtml(text) : text); }
  catch (error) { result.errors.push(error instanceof Error ? error.message : '恢复差异审计不是合法 JSON。'); return result; }
  const root = asRecord(parsed);
  if (!root) { result.errors.push('恢复差异审计顶层必须是 JSON 对象。'); return result; }
  const archive = asRecord(root.archive); const summary = asRecord(root.summary); const sourceStatuses = asRecord(summary?.sourceStatuses);
  const sections = asRecord(root.sections); const findings = asRecord(sections?.findings);
  const manifest = asRecord(root.manifest); const manifestSections = asRecord(manifest?.sections);
  result.format = typeof root.format === 'string' ? root.format : undefined;
  result.version = typeof root.version === 'number' ? root.version : undefined;
  result.archiveId = typeof archive?.id === 'string' ? archive.id : undefined;
  result.archiveVersion = typeof archive?.version === 'number' ? archive.version : undefined;
  result.disclosureMode = typeof archive?.disclosureMode === 'string' ? archive.disclosureMode : undefined;
  result.comparedAt = typeof root.comparedAt === 'string' ? root.comparedAt : undefined;
  const collectionFields = ['name', 'label', 'limit', 'current', 'incoming', 'newCount', 'identicalCount', 'conflictCount', 'merged', 'capacityStatus', 'items'];
  const collectionValues = Array.isArray(sections?.collections) ? sections.collections : [];
  result.unknownFields = [
    ...unknownKeys(root, ['format', 'version', 'id', 'comparedAt', 'archive', 'summary', 'sections', 'manifest'], ''),
    ...unknownKeys(archive, ['id', 'version', 'projectName', 'createdAt', 'disclosureMode'], 'archive.'),
    ...unknownKeys(summary, ['newRecords', 'identicalRecords', 'conflicts', 'intentionallyOmittedRecords', 'capacityRisks', 'sourceStatuses'], 'summary.'),
    ...unknownKeys(sourceStatuses, ['verified', 'available-unverified', 'missing', 'changed', 'pending-relocation'], 'summary.sourceStatuses.'),
    ...unknownKeys(sections, ['collections', 'omissions', 'disclosureDomains', 'capacities', 'sources', 'findings'], 'sections.'),
    ...arrayUnknownKeys(sections?.collections, collectionFields, 'sections.collections'),
    ...collectionValues.flatMap((collection, collectionIndex) => arrayUnknownKeys(asRecord(collection)?.items, ['id', 'status', 'incomingSha256', 'existingSha256', 'incomingSummary', 'existingSummary'], `sections.collections[${collectionIndex}].items`)),
    ...arrayUnknownKeys(sections?.omissions, ['collection', 'label', 'count', 'reason'], 'sections.omissions'),
    ...arrayUnknownKeys(sections?.capacities, ['collection', 'label', 'current', 'incomingNew', 'merged', 'limit', 'status'], 'sections.capacities'),
    ...arrayUnknownKeys(sections?.sources, ['id', 'name', 'path', 'status', 'expectedSize', 'duration', 'quickSha256'], 'sections.sources'),
    ...unknownKeys(findings, ['blockers', 'warnings'], 'sections.findings.'),
    ...unknownKeys(manifest, ['algorithm', 'canonicalization', 'sections', 'auditSha256'], 'manifest.'),
    ...unknownKeys(manifestSections, ['collections', 'omissions', 'disclosureDomains', 'capacities', 'sources', 'findings'], 'manifest.sections.'),
    ...Object.entries(manifestSections ?? {}).flatMap(([name, value]) => unknownKeys(asRecord(value), ['bytes', 'sha256'], `manifest.sections.${name}.`)),
  ].sort();
  let unsupported = false;
  if (root.format !== ARCHIVE_RESTORE_AUDIT_FORMAT) { result.errors.push(`不支持的恢复差异审计格式：${String(root.format ?? '缺失')}。`); unsupported = true; }
  if (root.version !== ARCHIVE_RESTORE_AUDIT_VERSION) { result.errors.push(`不支持的恢复差异审计版本：${String(root.version ?? '缺失')}。`); unsupported = true; }
  if (manifest?.algorithm !== 'SHA-256' || manifest?.canonicalization !== 'sorted-json-v1') { result.errors.push('不支持的哈希算法或 JSON 规范化规则。'); unsupported = true; }
  if (result.unknownFields.length) { result.errors.push(`存在未知关键字段：${result.unknownFields.join('、')}。`); unsupported = true; }
  if (typeof root.id !== 'string' || !root.id) result.errors.push('审计 ID 缺失或类型不正确。');
  if (typeof root.comparedAt !== 'string' || !Number.isFinite(Date.parse(root.comparedAt))) result.errors.push('本机比较时间缺失或格式不正确。');
  if (!archive || typeof archive.id !== 'string' || typeof archive.version !== 'number' || typeof archive.projectName !== 'string' || typeof archive.createdAt !== 'string' || !['legacy-full', 'minimal', 'custom', 'full'].includes(String(archive.disclosureMode))) result.errors.push('归档标识、版本、工程名、创建时间或披露模式缺失。');
  const values: Record<ArchiveRestoreAuditSectionName, unknown> = {
    collections: sections?.collections, omissions: sections?.omissions, disclosureDomains: sections?.disclosureDomains,
    capacities: sections?.capacities, sources: sections?.sources, findings: sections?.findings,
  };
  const names = Object.keys(values) as ArchiveRestoreAuditSectionName[];
  for (const name of names) {
    const expected = asRecord(manifestSections?.[name]);
    if (values[name] === undefined || !expected) {
      result.sections.push({ name, status: 'missing', expectedBytes: typeof expected?.bytes === 'number' ? expected.bytes : undefined, expectedSha256: typeof expected?.sha256 === 'string' ? expected.sha256 : undefined });
      result.errors.push(`${name} 数据段或清单缺失。`); continue;
    }
    if (typeof expected.bytes !== 'number' || typeof expected.sha256 !== 'string') {
      result.sections.push({ name, status: 'unsupported' }); result.errors.push(`${name} 清单结构不受支持。`); unsupported = true; continue;
    }
    const actual = await digest(values[name]);
    const verified = expected.bytes === actual.bytes && expected.sha256 === actual.sha256;
    result.sections.push({ name, status: verified ? 'verified' : 'tampered', expectedBytes: expected.bytes, actualBytes: actual.bytes, expectedSha256: expected.sha256, actualSha256: actual.sha256 });
    if (!verified) result.errors.push(`${name} 数据段与清单不一致。`);
  }
  const expectedAudit = typeof manifest?.auditSha256 === 'string' ? manifest.auditSha256 : undefined;
  const actualAudit = await digest({ archive: root.archive, comparedAt: root.comparedAt, summary: root.summary, sections: root.sections, sectionManifest: manifestSections });
  result.audit = { status: !expectedAudit ? 'missing' : expectedAudit === actualAudit.sha256 ? 'verified' : 'tampered', expectedSha256: expectedAudit, actualSha256: actualAudit.sha256 };
  if (!expectedAudit) result.errors.push('整份恢复差异审计 SHA-256 缺失。');
  else if (expectedAudit !== actualAudit.sha256) result.errors.push('整份恢复差异审计 SHA-256 与实际数据不一致。');
  if (typeof root.id === 'string' && root.id !== `restore-audit-${actualAudit.sha256.slice(0, 16)}`) result.errors.push('审计 ID 与实际总 SHA-256 不一致。');
  result.status = unsupported ? 'unsupported' : result.errors.length ? 'failed' : 'verified';
  return result;
}

export async function readVerifiedArchiveRestoreAuditText(text: string, fileType: 'json' | 'html'): Promise<{ verification: ArchiveRestoreAuditVerification; report?: ArchiveRestoreAuditReport }> {
  const verification = await verifyArchiveRestoreAuditText(text, fileType);
  if (verification.status !== 'verified') return { verification };
  const parsed = JSON.parse(fileType === 'html' ? extractRestoreAuditJsonFromHtml(text) : text) as ArchiveRestoreAuditReport;
  return { verification, report: structuredClone(parsed) };
}

export function archiveRestoreAuditFileType(fileName: string, mimeType = ''): 'json' | 'html' {
  if (/\.html?$/i.test(fileName) || /text\/html/i.test(mimeType)) return 'html';
  if (/\.json$/i.test(fileName) || /application\/json/i.test(mimeType)) return 'json';
  throw new Error('只支持恢复差异审计 .json、.html 或 .htm 文件。');
}
