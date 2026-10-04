import type { ProjectSnapshot } from '@/types';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';
import type { PostPublishObservation } from '@/lib/postPublishFeedback';
import type { PostPublishBatchRollback, PostPublishBatchSession } from '@/lib/postPublishBatchSession';
import { buildStoryLineage, type LineageNode, type StoryLineageEvidence } from '@/lib/storyLineage';

export const PUBLICATION_AUDIT_FORMAT = 'hyperframes-publication-evidence-audit' as const;
export const PUBLICATION_AUDIT_VERSION = 1 as const;

export interface PublicationAuditInput {
  snapshot: ProjectSnapshot;
  candidate?: ReleaseCandidate;
  evidence: StoryLineageEvidence;
  batchSessions: PostPublishBatchSession[];
  batchRollbacks: PostPublishBatchRollback[];
}

export interface PublicationAuditReport {
  format: typeof PUBLICATION_AUDIT_FORMAT;
  version: typeof PUBLICATION_AUDIT_VERSION;
  id: string;
  generatedAt: string;
  scope: string;
  privacyBoundary: string[];
  summary: { nodes: number; relationships: number; batchSessions: number; batchRollbacks: number; issues: number };
  sections: {
    lineage: { nodes: LineageNode[]; edges: Array<{ from: string; to: string; label: string }>; warnings: string[] };
    batchSessions: Array<{
      id: string; createdAt: string; sourceFileName: string; sourceFileSha256: string; format: string; templateId: string; templateName: string; confirmedAt: string;
      status: 'active' | 'rolled-back'; rows: PostPublishBatchSession['rows'];
    }>;
    batchRollbacks: PostPublishBatchRollback[];
  };
  issues: { missingSources: string[]; duplicateIds: string[]; hashConflicts: string[]; citationDrift: string[]; batchIntegrity: string[] };
  manifest: {
    algorithm: 'SHA-256'; canonicalization: 'sorted-json-v1'; evidenceSha256: string;
    sections: Record<'summary' | 'privacyBoundary' | 'lineage' | 'batchSessions' | 'batchRollbacks' | 'issues', { bytes: number; sha256: string }>;
  };
}

export type PublicationAuditSectionName = 'summary' | 'privacyBoundary' | 'lineage' | 'batchSessions' | 'batchRollbacks' | 'issues';
export interface PublicationAuditVerification {
  status: 'verified' | 'failed' | 'unsupported';
  fileType: 'json' | 'html';
  scope?: string;
  generatedAt?: string;
  format?: string;
  version?: number;
  unknownFields: string[];
  errors: string[];
  sections: Array<{ name: PublicationAuditSectionName; status: 'verified' | 'tampered' | 'missing' | 'unsupported'; expectedBytes?: number; actualBytes?: number; expectedSha256?: string; actualSha256?: string }>;
  evidence: { status: 'verified' | 'tampered' | 'missing'; expectedSha256?: string; actualSha256?: string };
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

function sanitizedNode(node: LineageNode): LineageNode {
  const omitted = new Set(['输出文件', '渲染报告']);
  return { ...structuredClone(node), details: node.details.map(([label, value]) => omitted.has(label) ? [label, '已省略本机路径'] : [label, value]) };
}

function classifyWarnings(warnings: string[], nodes: LineageNode[]) {
  const missingSources = [...nodes.filter((item) => item.kind === 'missing').map((item) => `${item.label}：${item.status}`), ...warnings.filter((item) => /缺失|不存在|断裂/.test(item))];
  return {
    missingSources: [...new Set(missingSources)].sort(),
    duplicateIds: [...new Set(warnings.filter((item) => /重复|冲突/.test(item) && !/哈希/.test(item)))].sort(),
    hashConflicts: [...new Set(warnings.filter((item) => /哈希|SHA-256/.test(item) && /冲突|不一致|缺少/.test(item)))].sort(),
    citationDrift: [...new Set(warnings.filter((item) => /引用/.test(item) && /不一致|漂移|断裂|缺失|不存在/.test(item)))].sort(),
  };
}

function batchIntegrityIssues(observations: PostPublishObservation[], sessions: PostPublishBatchSession[], rollbacks: PostPublishBatchRollback[]) {
  const issues: string[] = [];
  const observationIds = new Set(observations.map((item) => item.id));
  const sessionIds = new Set<string>();
  const rollbackIds = new Set<string>();
  const rollbackBySession = new Map<string, PostPublishBatchRollback>();
  const owners = new Map<string, string>();
  for (const rollback of rollbacks) {
    if (rollbackIds.has(rollback.id)) issues.push(`回滚回执 ID ${rollback.id} 重复。`);
    if (rollbackBySession.has(rollback.sessionId)) issues.push(`批次 ${rollback.sessionId} 存在多个回滚回执。`);
    rollbackIds.add(rollback.id); rollbackBySession.set(rollback.sessionId, rollback);
  }
  for (const session of sessions) {
    if (sessionIds.has(session.id)) issues.push(`批次会话 ID ${session.id} 重复。`);
    sessionIds.add(session.id);
    const rollback = rollbackBySession.get(session.id);
    for (const row of session.rows) {
      const owner = owners.get(row.observationId);
      if (owner && owner !== session.id) issues.push(`观察 ${row.observationId} 同时归属批次 ${owner} 与 ${session.id}。`);
      owners.set(row.observationId, session.id);
      if (!rollback && !observationIds.has(row.observationId)) issues.push(`活跃批次 ${session.id} 的观察 ${row.observationId} 缺失。`);
      if (rollback && observationIds.has(row.observationId)) issues.push(`已回滚批次 ${session.id} 的观察 ${row.observationId} 仍存在。`);
    }
    if (rollback) {
      const expected = session.rows.map((item) => item.observationId).sort();
      const actual = [...rollback.observationIds].sort();
      if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) issues.push(`回滚回执 ${rollback.id} 未完整覆盖批次 ${session.id}。`);
    }
  }
  for (const rollback of rollbacks) if (!sessionIds.has(rollback.sessionId)) issues.push(`回滚回执 ${rollback.id} 引用的批次 ${rollback.sessionId} 缺失。`);
  return [...new Set(issues)].sort();
}

export async function createPublicationAuditReport(input: PublicationAuditInput, now = new Date()): Promise<PublicationAuditReport> {
  const graph = buildStoryLineage(input.snapshot, input.candidate, input.evidence, now);
  const nodes = graph.nodes.map(sanitizedNode).sort((a, b) => a.id.localeCompare(b.id));
  const edges = structuredClone(graph.edges).sort((a, b) => `${a.from}\0${a.to}\0${a.label}`.localeCompare(`${b.from}\0${b.to}\0${b.label}`));
  const warnings = [...new Set(graph.warnings)].sort();
  const rollbacks = structuredClone(input.batchRollbacks).map((item) => ({ ...item, observationIds: [...item.observationIds].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  const rollbackSessions = new Set(rollbacks.map((item) => item.sessionId));
  const batchSessions = input.batchSessions.map((session) => ({
    id: session.id, createdAt: session.createdAt, sourceFileName: session.sourceFileName, sourceFileSha256: session.sourceFileSha256, format: session.format,
    templateId: session.template.id, templateName: session.template.name, confirmedAt: session.confirmedAt,
    status: rollbackSessions.has(session.id) ? 'rolled-back' as const : 'active' as const,
    rows: structuredClone(session.rows).sort((a, b) => a.rowIndex - b.rowIndex || a.observationId.localeCompare(b.observationId)),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const classified = classifyWarnings(warnings, nodes);
  const issues = { ...classified, batchIntegrity: batchIntegrityIssues(input.evidence.observations, input.batchSessions, input.batchRollbacks) };
  const issueCount = new Set(Object.values(issues).flat()).size;
  const privacyBoundary = [
    '不包含原片、代理视频、渲染成片或任何媒体二进制内容。',
    '不包含转写全文、字幕全文或平台原始导出文件内容。',
    '本机渲染输出路径与渲染报告路径已省略；仅保留结构化摘要、人工结论、关系和已有哈希。',
    '缺失、冲突与漂移关系按原状态保留，不补接或推断。',
  ];
  const summary = { nodes: nodes.length, relationships: edges.length, batchSessions: batchSessions.length, batchRollbacks: rollbacks.length, issues: issueCount };
  const sections = { summary, privacyBoundary, lineage: { nodes, edges, warnings }, batchSessions, batchRollbacks: rollbacks, issues };
  const names = Object.keys(sections) as Array<keyof typeof sections>;
  const entries = await Promise.all(names.map(async (name) => [name, await digest(sections[name])] as const));
  const evidenceSha256 = (await digest(sections)).sha256;
  return {
    format: PUBLICATION_AUDIT_FORMAT, version: PUBLICATION_AUDIT_VERSION, id: `publication-audit-${evidenceSha256.slice(0, 16)}`, generatedAt: now.toISOString(), scope: graph.scope,
    privacyBoundary, summary, sections: { lineage: sections.lineage, batchSessions, batchRollbacks: rollbacks }, issues,
    manifest: { algorithm: 'SHA-256', canonicalization: 'sorted-json-v1', evidenceSha256, sections: Object.fromEntries(entries) as PublicationAuditReport['manifest']['sections'] },
  };
}

function htmlEscape(value: unknown) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

export function publicationAuditReportToHtml(report: PublicationAuditReport) {
  const issueRows = Object.entries(report.issues).flatMap(([kind, items]) => items.map((item) => `<li><strong>${htmlEscape(kind)}</strong> ${htmlEscape(item)}</li>`)).join('') || '<li>未发现异常。</li>';
  const nodeRows = report.sections.lineage.nodes.map((node) => `<tr><td>${htmlEscape(node.kind)}</td><td>${htmlEscape(node.label)}</td><td>${htmlEscape(node.status)}</td><td>${node.details.map(([key, value]) => `<div><b>${htmlEscape(key)}</b> ${htmlEscape(value)}</div>`).join('')}</td></tr>`).join('');
  const batchRows = report.sections.batchSessions.map((session) => `<tr><td>${htmlEscape(session.id)}</td><td>${htmlEscape(session.status)}</td><td>${htmlEscape(session.sourceFileName)}</td><td>${session.rows.length}</td><td>${htmlEscape(session.sourceFileSha256)}</td></tr>`).join('') || '<tr><td colspan="5">没有批次会话。</td></tr>';
  const rollbackRows = report.sections.batchRollbacks.map((item) => `<li>${htmlEscape(item.id)} · ${htmlEscape(item.sessionId)} · ${htmlEscape(item.rolledBackAt)} · ${htmlEscape(item.reason)}</li>`).join('') || '<li>没有回滚回执。</li>';
  const embedded = JSON.stringify(report).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>HyperFrames 发布证据审计</title><style>body{font:14px/1.55 system-ui;margin:32px;color:#18202b;background:#f6f8fb}main{max-width:1200px;margin:auto;background:white;padding:28px;border-radius:12px}code{word-break:break-all}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d8dee8;padding:8px;vertical-align:top;text-align:left}.muted{color:#637083}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.card{padding:12px;background:#eef2ff;border-radius:8px}</style></head><body><main><h1>发布证据审计报告</h1><p>${htmlEscape(report.scope)}</p><p class="muted">生成时间 ${htmlEscape(report.generatedAt)} · 数据 SHA-256 <code>${report.manifest.evidenceSha256}</code></p><div class="grid"><div class="card">节点 ${report.summary.nodes}</div><div class="card">关系 ${report.summary.relationships}</div><div class="card">批次 ${report.summary.batchSessions}</div><div class="card">回滚 ${report.summary.batchRollbacks}</div><div class="card">异常 ${report.summary.issues}</div></div><h2>披露边界</h2><ul>${report.privacyBoundary.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul><h2>异常与断裂</h2><ul>${issueRows}</ul><h2>证据节点</h2><table><thead><tr><th>类型</th><th>名称</th><th>状态</th><th>摘要</th></tr></thead><tbody>${nodeRows}</tbody></table><h2>批次会话</h2><table><thead><tr><th>ID</th><th>状态</th><th>来源文件</th><th>行数</th><th>文件 SHA-256</th></tr></thead><tbody>${batchRows}</tbody></table><h2>回滚回执</h2><ul>${rollbackRows}</ul><script id="publication-audit-data" type="application/json">${embedded}</script></main></body></html>`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unknownKeys(record: Record<string, unknown> | undefined, allowed: string[], path: string) {
  if (!record) return [];
  const known = new Set(allowed);
  return Object.keys(record).filter((key) => !known.has(key)).map((key) => `${path}${key}`);
}

function decodeHtmlJson(value: string) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function extractAuditJsonFromHtml(html: string) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const matches = scripts.filter((item) => /\bid\s*=\s*(["'])publication-audit-data\1/i.test(item[1]));
  if (matches.length !== 1) throw new Error(matches.length ? 'HTML 包含多个 publication-audit-data 数据块。' : 'HTML 缺少 publication-audit-data 数据块。');
  if (!/\btype\s*=\s*(["'])application\/json\1/i.test(matches[0][1])) throw new Error('审计数据块不是 application/json 类型。');
  const raw = matches[0][2].trim();
  try { JSON.parse(raw); return raw; } catch {
    const decoded = decodeHtmlJson(raw);
    JSON.parse(decoded); return decoded;
  }
}

export async function verifyPublicationAuditText(text: string, fileType: 'json' | 'html'): Promise<PublicationAuditVerification> {
  const result: PublicationAuditVerification = { status: 'failed', fileType, unknownFields: [], errors: [], sections: [], evidence: { status: 'missing' } };
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) { result.errors.push('审计文件超过 10 MB 安全上限。'); return result; }
  let parsed: unknown;
  try { parsed = JSON.parse(fileType === 'html' ? extractAuditJsonFromHtml(text) : text); }
  catch (error) { result.errors.push(error instanceof Error ? error.message : '审计数据不是合法 JSON。'); return result; }
  const root = asRecord(parsed);
  if (!root) { result.errors.push('审计报告顶层必须是 JSON 对象。'); return result; }
  result.format = typeof root.format === 'string' ? root.format : undefined;
  result.version = typeof root.version === 'number' ? root.version : undefined;
  result.scope = typeof root.scope === 'string' ? root.scope : undefined;
  result.generatedAt = typeof root.generatedAt === 'string' ? root.generatedAt : undefined;
  const allowedTop = ['format', 'version', 'id', 'generatedAt', 'scope', 'privacyBoundary', 'summary', 'sections', 'issues', 'manifest'];
  const sectionRecord = asRecord(root.sections); const issueRecord = asRecord(root.issues); const manifest = asRecord(root.manifest); const manifestSections = asRecord(manifest?.sections);
  result.unknownFields = [
    ...unknownKeys(root, allowedTop, ''),
    ...unknownKeys(sectionRecord, ['lineage', 'batchSessions', 'batchRollbacks'], 'sections.'),
    ...unknownKeys(issueRecord, ['missingSources', 'duplicateIds', 'hashConflicts', 'citationDrift', 'batchIntegrity'], 'issues.'),
    ...unknownKeys(manifest, ['algorithm', 'canonicalization', 'evidenceSha256', 'sections'], 'manifest.'),
    ...unknownKeys(manifestSections, ['summary', 'privacyBoundary', 'lineage', 'batchSessions', 'batchRollbacks', 'issues'], 'manifest.sections.'),
  ].sort();
  let unsupported = false;
  if (root.format !== PUBLICATION_AUDIT_FORMAT) { result.errors.push(`不支持的报告格式：${String(root.format ?? '缺失')}。`); unsupported = true; }
  if (root.version !== PUBLICATION_AUDIT_VERSION) { result.errors.push(`不支持的报告版本：${String(root.version ?? '缺失')}。`); unsupported = true; }
  if (typeof root.id !== 'string' || !root.id) result.errors.push('报告 ID 缺失或类型不正确。');
  if (typeof root.scope !== 'string' || !root.scope) result.errors.push('审计范围缺失或类型不正确。');
  if (typeof root.generatedAt !== 'string' || !Number.isFinite(Date.parse(root.generatedAt))) result.errors.push('生成时间缺失或格式不正确。');
  if (manifest?.algorithm !== 'SHA-256' || manifest?.canonicalization !== 'sorted-json-v1') { result.errors.push('不支持的哈希算法或 JSON 规范化规则。'); unsupported = true; }
  if (result.unknownFields.length) { result.errors.push(`存在未知关键字段：${result.unknownFields.join('、')}。`); unsupported = true; }
  const values: Record<PublicationAuditSectionName, unknown> = {
    summary: root.summary, privacyBoundary: root.privacyBoundary, lineage: sectionRecord?.lineage,
    batchSessions: sectionRecord?.batchSessions, batchRollbacks: sectionRecord?.batchRollbacks, issues: root.issues,
  };
  const names = Object.keys(values) as PublicationAuditSectionName[];
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
  const actualEvidence = await digest(values);
  const expectedEvidence = typeof manifest?.evidenceSha256 === 'string' ? manifest.evidenceSha256 : undefined;
  result.evidence = { status: !expectedEvidence ? 'missing' : expectedEvidence === actualEvidence.sha256 ? 'verified' : 'tampered', expectedSha256: expectedEvidence, actualSha256: actualEvidence.sha256 };
  if (!expectedEvidence) result.errors.push('整份证据 SHA-256 缺失。');
  else if (expectedEvidence !== actualEvidence.sha256) result.errors.push('整份证据 SHA-256 与实际数据不一致。');
  if (typeof root.id === 'string' && root.id !== `publication-audit-${actualEvidence.sha256.slice(0, 16)}`) result.errors.push('报告 ID 与实际证据 SHA-256 不一致。');
  result.status = unsupported ? 'unsupported' : result.errors.length ? 'failed' : 'verified';
  return result;
}

export async function readVerifiedPublicationAuditText(text: string, fileType: 'json' | 'html'): Promise<{ verification: PublicationAuditVerification; report?: PublicationAuditReport }> {
  const verification = await verifyPublicationAuditText(text, fileType);
  if (verification.status !== 'verified') return { verification };
  const parsed = JSON.parse(fileType === 'html' ? extractAuditJsonFromHtml(text) : text) as PublicationAuditReport;
  return { verification, report: structuredClone(parsed) };
}

export function publicationAuditFileType(fileName: string, mimeType = ''): 'json' | 'html' {
  if (/\.html?$/i.test(fileName) || /text\/html/i.test(mimeType)) return 'html';
  if (/\.json$/i.test(fileName) || /application\/json/i.test(mimeType)) return 'json';
  throw new Error('只支持 .audit.json、.json、.audit.html 或 .html 审计文件。');
}
