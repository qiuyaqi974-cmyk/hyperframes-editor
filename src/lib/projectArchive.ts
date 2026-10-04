import type { ProjectSnapshot } from '@/types';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';
import type { PostPublishObservation } from '@/lib/postPublishFeedback';
import type { PostPublishExperimentReview } from '@/lib/postPublishExperiment';
import type { DirectorLearningRecord } from '@/lib/directorLearningLibrary';
import type { PostPublishBatchRollback, PostPublishBatchSession } from '@/lib/postPublishBatchSession';

export const PROJECT_ARCHIVE_FORMAT = 'hyperframes-project-archive' as const;
export const PROJECT_ARCHIVE_VERSION = 2 as const;
export const PROJECT_ARCHIVE_SELECTIVE_VERSION = 3 as const;

export interface ArchiveDisclosureSelection {
  publicationEvidence: boolean;
  directorLearning: boolean;
  batchAudit: boolean;
}

export interface ArchiveDisclosurePolicy {
  mode: 'minimal' | 'custom' | 'full';
  requested: ArchiveDisclosureSelection;
  included: { releaseCandidates: number; postPublishObservations: number; postPublishExperiments: number; directorLearning: number; postPublishBatchSessions: number; postPublishBatchRollbacks: number };
  excluded: { releaseCandidates: number; postPublishObservations: number; postPublishExperiments: number; directorLearning: number; postPublishBatchSessions: number; postPublishBatchRollbacks: number };
  dependencyClosureAdded: { releaseCandidates: number; postPublishObservations: number; postPublishExperiments: number };
  sensitiveSummaries: string[];
  omittedDomains: string[];
}

export interface ArchiveDisclosurePlan {
  selection: ArchiveDisclosureSelection;
  policy: ArchiveDisclosurePolicy;
  sections: ProjectArchiveCreateSections;
  blockers: string[];
  requiresDependencyAcceptance: boolean;
}

export interface ArchiveSourceInspection {
  path: string;
  status: 'available' | 'missing';
  size?: number;
  mtimeMs?: number;
  quickSha256?: string;
  duration?: number;
  width?: number;
  height?: number;
}

export interface ArchiveSourceReference {
  id: string;
  name: string;
  path: string;
  proxyPath?: string;
  expectedSize: number;
  duration: number;
  width: number;
  height: number;
  archivedStatus: 'verified' | 'missing' | 'metadata-only';
  mtimeMs?: number;
  quickSha256?: string;
  transcriptionFingerprint?: string;
}

export interface ProjectArchiveSections {
  project: ProjectSnapshot;
  releaseCandidates: ReleaseCandidate[];
  postPublishObservations: PostPublishObservation[];
  postPublishExperiments: PostPublishExperimentReview[];
  directorLearning: DirectorLearningRecord[];
  /** Absent only in legacy v1 archives. Never synthesize these for v1. */
  postPublishBatchSessions?: PostPublishBatchSession[];
  /** Absent only in legacy v1 archives. Never synthesize these for v1. */
  postPublishBatchRollbacks?: PostPublishBatchRollback[];
}

export interface ProjectArchiveCreateSections extends ProjectArchiveSections {
  postPublishBatchSessions: PostPublishBatchSession[];
  postPublishBatchRollbacks: PostPublishBatchRollback[];
}

export type ProjectArchiveSectionName = keyof ProjectArchiveSections | 'sourceReferences' | 'archiveMetadata';
export type ProjectArchiveManifestSectionName = ProjectArchiveSectionName | 'disclosurePolicy';

export interface ProjectArchive {
  format: typeof PROJECT_ARCHIVE_FORMAT;
  version: 1 | typeof PROJECT_ARCHIVE_VERSION | typeof PROJECT_ARCHIVE_SELECTIVE_VERSION;
  id: string;
  createdAt: string;
  projectName: string;
  policy: {
    includesOriginalMedia: false;
    preservesAbsolutePaths: true;
    restoreRequiresPreview: true;
  };
  sections: ProjectArchiveSections;
  sourceReferences: ArchiveSourceReference[];
  disclosure?: ArchiveDisclosurePolicy;
  manifest: {
    algorithm: 'SHA-256';
    canonicalization: 'sorted-json-v1';
    sections: Partial<Record<ProjectArchiveManifestSectionName, { bytes: number; sha256: string }>>;
  };
}

export interface ProjectArchiveRestorePreview {
  archive: ProjectArchive;
  integrity: 'verified' | 'failed';
  integrityErrors: string[];
  restoredProjectName: string;
  currentProjectName: string;
  counts: Record<Exclude<ProjectArchiveSectionName, 'project' | 'sourceReferences' | 'archiveMetadata'>, number>;
  sourceResults: Array<ArchiveSourceReference & { restoreStatus: 'verified' | 'available-unverified' | 'missing' | 'changed' }>;
  conflicts: string[];
  blockers: string[];
  warnings: string[];
}

export interface ArchiveSourceRelocationReview {
  sourceId: string;
  originalPath: string;
  candidate: ArchiveSourceInspection & { status: 'available'; size: number; duration: number };
  comparison: {
    size: 'match' | 'mismatch';
    duration: 'match' | 'mismatch';
    quickSha256: 'match' | 'mismatch' | 'unavailable';
  };
  blockers: string[];
  warnings: string[];
}

export interface ConfirmedArchiveSourceRelocation extends ArchiveSourceRelocationReview {
  confirmedAt: string;
}

export interface ExistingArchiveCollections {
  releaseCandidates: ReleaseCandidate[];
  postPublishObservations: PostPublishObservation[];
  postPublishExperiments: PostPublishExperimentReview[];
  directorLearning: DirectorLearningRecord[];
  postPublishBatchSessions: PostPublishBatchSession[];
  postPublishBatchRollbacks: PostPublishBatchRollback[];
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

function sourceReferences(project: ProjectSnapshot, inspections: ArchiveSourceInspection[]) {
  const byPath = new Map(inspections.map((item) => [item.path.toLocaleLowerCase(), item]));
  return (project.sourceMedia ?? []).map((source): ArchiveSourceReference => {
    const inspection = byPath.get(source.path.toLocaleLowerCase());
    const available = inspection?.status === 'available';
    return {
      id: source.id,
      name: source.name,
      path: source.path,
      ...(source.proxyPath ? { proxyPath: source.proxyPath } : {}),
      expectedSize: available && inspection.size !== undefined ? inspection.size : source.size,
      duration: source.duration,
      width: source.width,
      height: source.height,
      archivedStatus: available && inspection.quickSha256 ? 'verified' : inspection?.status === 'missing' ? 'missing' : 'metadata-only',
      ...(inspection?.mtimeMs !== undefined ? { mtimeMs: inspection.mtimeMs } : {}),
      ...(inspection?.quickSha256 ? { quickSha256: inspection.quickSha256 } : {}),
      ...(source.transcription?.sourceFingerprint ? { transcriptionFingerprint: source.transcription.sourceFingerprint } : {}),
    };
  });
}

export async function createProjectArchive(sections: ProjectArchiveCreateSections, inspections: ArchiveSourceInspection[] = [], now = new Date()): Promise<ProjectArchive> {
  if (!sections.project || sections.project.app !== 'hyperframes-editor') throw new Error('归档必须包含有效的 HyperFrames 工程快照。');
  const portableSections = JSON.parse(JSON.stringify(sections)) as ProjectArchiveCreateSections;
  const references = sourceReferences(portableSections.project, inspections);
  const id = `archive-${now.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = now.toISOString();
  const policy = { includesOriginalMedia: false as const, preservesAbsolutePaths: true as const, restoreRequiresPreview: true as const };
  const archiveMetadata = { format: PROJECT_ARCHIVE_FORMAT, version: PROJECT_ARCHIVE_VERSION, id, createdAt, projectName: portableSections.project.projectName, policy };
  const values: Record<ProjectArchiveSectionName, unknown> = { ...portableSections, sourceReferences: references, archiveMetadata };
  const entries = await Promise.all((Object.keys(values) as ProjectArchiveSectionName[]).map(async (name) => [name, await digest(values[name])] as const));
  return {
    format: PROJECT_ARCHIVE_FORMAT,
    version: PROJECT_ARCHIVE_VERSION,
    id,
    createdAt,
    projectName: sections.project.projectName,
    policy,
    sections: portableSections,
    sourceReferences: references,
    manifest: { algorithm: 'SHA-256', canonicalization: 'sorted-json-v1', sections: Object.fromEntries(entries) as ProjectArchive['manifest']['sections'] },
  };
}

export function planProjectArchiveDisclosure(sections: ProjectArchiveCreateSections, selection: ArchiveDisclosureSelection): ArchiveDisclosurePlan {
  const blockers: string[] = [];
  const candidateMap = new Map(sections.releaseCandidates.map((item) => [item.id, item]));
  const observationMap = new Map(sections.postPublishObservations.map((item) => [item.id, item]));
  const experimentMap = new Map(sections.postPublishExperiments.map((item) => [item.id, item]));
  const sessionMap = new Map(sections.postPublishBatchSessions.map((item) => [item.id, item]));
  const rollbackBySession = new Map(sections.postPublishBatchRollbacks.map((item) => [item.sessionId, item]));
  const candidateIds = new Set<string>(); const observationIds = new Set<string>(); const experimentIds = new Set<string>();
  const learningIds = new Set<string>(); const sessionIds = new Set<string>(); const rollbackIds = new Set<string>();
  const addCandidate = (id: string, source: string) => candidateMap.has(id) ? candidateIds.add(id) : blockers.push(`${source} 引用的 RC ${id} 缺失。`);
  const addObservation = (id: string, source: string) => {
    const observation = observationMap.get(id);
    if (!observation) { blockers.push(`${source} 引用的发布观察 ${id} 缺失。`); return; }
    observationIds.add(id); addCandidate(observation.rcId, `发布观察 ${id}`);
  };
  const addExperiment = (id: string, source: string) => {
    const experiment = experimentMap.get(id);
    if (!experiment) { blockers.push(`${source} 引用的实验 ${id} 缺失。`); return; }
    experimentIds.add(id); addObservation(experiment.leftObservationId, `实验 ${id}`); addObservation(experiment.rightObservationId, `实验 ${id}`);
    addCandidate(experiment.leftRcId, `实验 ${id}`); addCandidate(experiment.rightRcId, `实验 ${id}`);
  };
  if (selection.publicationEvidence) {
    sections.postPublishObservations.forEach((item) => addObservation(item.id, '发布证据域'));
    sections.postPublishExperiments.forEach((item) => addExperiment(item.id, '发布证据域'));
  }
  if (selection.directorLearning) {
    for (const record of sections.directorLearning) {
      learningIds.add(record.id);
      record.provenance.observationIds.forEach((id) => addObservation(id, `学习记录 ${record.id}`));
      record.provenance.rcIds.forEach((id) => addCandidate(id, `学习记录 ${record.id}`));
      if (record.sourceKind === 'experiment-review') addExperiment(record.id.replace(/^learning:experiment:/, ''), `学习记录 ${record.id}`);
    }
  }
  if (selection.batchAudit) {
    for (const session of sections.postPublishBatchSessions) {
      sessionIds.add(session.id);
      const rollback = rollbackBySession.get(session.id);
      for (const row of session.rows) {
        addCandidate(row.rcId, `批次 ${session.id}`);
        if (!rollback) addObservation(row.observationId, `活跃批次 ${session.id}`);
        else if (observationMap.has(row.observationId)) blockers.push(`已回滚批次 ${session.id} 的观察 ${row.observationId} 仍存在，不能生成会复活证据的归档。`);
      }
    }
    for (const rollback of sections.postPublishBatchRollbacks) {
      rollbackIds.add(rollback.id);
      if (!sessionMap.has(rollback.sessionId)) blockers.push(`回滚回执 ${rollback.id} 引用的批次 ${rollback.sessionId} 缺失。`);
    }
  }
  const picked = {
    project: structuredClone(sections.project),
    releaseCandidates: sections.releaseCandidates.filter((item) => candidateIds.has(item.id)).map((item) => structuredClone(item)),
    postPublishObservations: sections.postPublishObservations.filter((item) => observationIds.has(item.id)).map((item) => structuredClone(item)),
    postPublishExperiments: sections.postPublishExperiments.filter((item) => experimentIds.has(item.id)).map((item) => structuredClone(item)),
    directorLearning: sections.directorLearning.filter((item) => learningIds.has(item.id)).map((item) => structuredClone(item)),
    postPublishBatchSessions: sections.postPublishBatchSessions.filter((item) => sessionIds.has(item.id)).map((item) => structuredClone(item)),
    postPublishBatchRollbacks: sections.postPublishBatchRollbacks.filter((item) => rollbackIds.has(item.id)).map((item) => structuredClone(item)),
  };
  const duplicateIds = <T extends { id: string }>(items: T[], label: string) => {
    const counts = new Map<string, number>(); items.forEach((item) => counts.set(item.id, (counts.get(item.id) ?? 0) + 1));
    for (const [id, count] of counts) if (count > 1) blockers.push(`${label} ID ${id} 重复 ${count} 次，不能生成无歧义依赖闭包。`);
  };
  duplicateIds(picked.releaseCandidates, 'RC'); duplicateIds(picked.postPublishObservations, '发布观察'); duplicateIds(picked.postPublishExperiments, '实验'); duplicateIds(picked.directorLearning, '学习记录');
  blockers.push(...validateArchiveBatchCollections({ postPublishObservations: picked.postPublishObservations, postPublishBatchSessions: picked.postPublishBatchSessions, postPublishBatchRollbacks: picked.postPublishBatchRollbacks }, { postPublishObservations: [], postPublishBatchSessions: [], postPublishBatchRollbacks: [] }));
  const included = {
    releaseCandidates: picked.releaseCandidates.length, postPublishObservations: picked.postPublishObservations.length, postPublishExperiments: picked.postPublishExperiments.length,
    directorLearning: picked.directorLearning.length, postPublishBatchSessions: picked.postPublishBatchSessions.length, postPublishBatchRollbacks: picked.postPublishBatchRollbacks.length,
  };
  const excluded = {
    releaseCandidates: sections.releaseCandidates.length - included.releaseCandidates, postPublishObservations: sections.postPublishObservations.length - included.postPublishObservations,
    postPublishExperiments: sections.postPublishExperiments.length - included.postPublishExperiments, directorLearning: sections.directorLearning.length - included.directorLearning,
    postPublishBatchSessions: sections.postPublishBatchSessions.length - included.postPublishBatchSessions, postPublishBatchRollbacks: sections.postPublishBatchRollbacks.length - included.postPublishBatchRollbacks,
  };
  const directObservations = selection.publicationEvidence ? sections.postPublishObservations.length : 0;
  const directExperiments = selection.publicationEvidence ? sections.postPublishExperiments.length : 0;
  const dependencyClosureAdded = { releaseCandidates: included.releaseCandidates, postPublishObservations: Math.max(0, included.postPublishObservations - directObservations), postPublishExperiments: Math.max(0, included.postPublishExperiments - directExperiments) };
  const requestedCount = Object.values(selection).filter(Boolean).length;
  const sensitiveSummaries = ['工程快照及外部素材绝对路径', ...(included.postPublishObservations ? ['平台、账号、内容 ID 与聚合指标'] : []), ...(included.directorLearning ? ['人工学习结论、理由与引用凭证'] : []), ...(included.postPublishBatchSessions || included.postPublishBatchRollbacks ? ['导入文件名/哈希、模板、逐行回执与回滚原因'] : [])];
  const omittedDomains = [...(!selection.publicationEvidence ? [`发布观察与实验${included.postPublishObservations || included.postPublishExperiments ? '（仅含依赖闭包必需记录）' : ''}`] : []), ...(!selection.directorLearning ? ['跨项目导演学习'] : []), ...(!selection.batchAudit ? ['批次会话与回滚回执'] : [])];
  return {
    selection: structuredClone(selection), sections: picked, blockers: [...new Set(blockers)],
    requiresDependencyAcceptance: Object.values(dependencyClosureAdded).some((count) => count > 0),
    policy: { mode: requestedCount === 0 ? 'minimal' : requestedCount === 3 ? 'full' : 'custom', requested: structuredClone(selection), included, excluded, dependencyClosureAdded, sensitiveSummaries, omittedDomains },
  };
}

export async function createSelectiveProjectArchive(sections: ProjectArchiveCreateSections, selection: ArchiveDisclosureSelection, dependencyClosureAccepted: boolean, inspections: ArchiveSourceInspection[] = [], now = new Date()): Promise<ProjectArchive> {
  const plan = planProjectArchiveDisclosure(sections, selection);
  if (plan.blockers.length) throw new Error(`归档依赖存在 ${plan.blockers.length} 个阻断项：${plan.blockers.join('；')}`);
  if (plan.requiresDependencyAcceptance && !dependencyClosureAccepted) throw new Error('必须检查并接受依赖闭包后才能导出。');
  const portableSections = JSON.parse(JSON.stringify(plan.sections)) as ProjectArchiveCreateSections;
  const references = sourceReferences(portableSections.project, inspections);
  const id = `archive-${now.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = now.toISOString();
  const policy = { includesOriginalMedia: false as const, preservesAbsolutePaths: true as const, restoreRequiresPreview: true as const };
  const archiveMetadata = { format: PROJECT_ARCHIVE_FORMAT, version: PROJECT_ARCHIVE_SELECTIVE_VERSION, id, createdAt, projectName: portableSections.project.projectName, policy };
  const values: Record<ProjectArchiveManifestSectionName, unknown> = { ...portableSections, sourceReferences: references, archiveMetadata, disclosurePolicy: plan.policy };
  const entries = await Promise.all((Object.keys(values) as ProjectArchiveManifestSectionName[]).map(async (name) => [name, await digest(values[name])] as const));
  return { format: PROJECT_ARCHIVE_FORMAT, version: PROJECT_ARCHIVE_SELECTIVE_VERSION, id, createdAt, projectName: portableSections.project.projectName, policy, sections: portableSections, sourceReferences: references, disclosure: structuredClone(plan.policy), manifest: { algorithm: 'SHA-256', canonicalization: 'sorted-json-v1', sections: Object.fromEntries(entries) } };
}

export function parseProjectArchive(text: string): ProjectArchive {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('恢复包不是合法的 JSON。'); }
  const archive = value as Partial<ProjectArchive>;
  if (archive.format !== PROJECT_ARCHIVE_FORMAT || ![1, PROJECT_ARCHIVE_VERSION, PROJECT_ARCHIVE_SELECTIVE_VERSION].includes(archive.version as number)) throw new Error('不是受支持的 HyperFrames 工程归档。');
  if (!archive.sections?.project || archive.sections.project.app !== 'hyperframes-editor') throw new Error('恢复包缺少有效工程快照。');
  if (!archive.manifest?.sections || !Array.isArray(archive.sourceReferences)) throw new Error('恢复包缺少完整性清单或原片引用清单。');
  if ((archive.version as number) >= PROJECT_ARCHIVE_VERSION && (!Array.isArray(archive.sections.postPublishBatchSessions) || !Array.isArray(archive.sections.postPublishBatchRollbacks))) {
    throw new Error(`v${archive.version} 恢复包缺少批次会话或回滚回执数据段。`);
  }
  if (archive.version === PROJECT_ARCHIVE_SELECTIVE_VERSION && (!archive.disclosure || !archive.manifest.sections.disclosurePolicy)) throw new Error('v3 恢复包缺少披露策略或其完整性清单。');
  return archive as ProjectArchive;
}

function collision<T extends { id: string }>(incoming: T[], existing: T[], label: string) {
  const current = new Map(existing.map((item) => [item.id, canonicalize(item)]));
  return incoming.flatMap((item) => current.has(item.id) && current.get(item.id) !== canonicalize(item) ? [`${label} ${item.id} 与本机同 ID 记录内容不同。`] : []);
}

export function validateArchiveBatchCollections(incoming: Pick<ExistingArchiveCollections, 'postPublishObservations' | 'postPublishBatchSessions' | 'postPublishBatchRollbacks'>, existing: Pick<ExistingArchiveCollections, 'postPublishObservations' | 'postPublishBatchSessions' | 'postPublishBatchRollbacks'>) {
  const blockers: string[] = [];
  const incomingObservations = new Set(incoming.postPublishObservations.map((item) => item.id));
  const existingObservations = new Set(existing.postPublishObservations.map((item) => item.id));
  const incomingSessions = new Map(incoming.postPublishBatchSessions.map((item) => [item.id, item]));
  const incomingRollbacks = new Map(incoming.postPublishBatchRollbacks.map((item) => [item.sessionId, item]));
  const allRollbacks = new Map([...existing.postPublishBatchRollbacks, ...incoming.postPublishBatchRollbacks].map((item) => [item.sessionId, item]));
  if (incomingSessions.size !== incoming.postPublishBatchSessions.length) blockers.push('归档包含重复的批次会话 ID。');
  if (new Set(incoming.postPublishBatchRollbacks.map((item) => item.id)).size !== incoming.postPublishBatchRollbacks.length) blockers.push('归档包含重复的批次回滚回执 ID。');
  if (incomingRollbacks.size !== incoming.postPublishBatchRollbacks.length) blockers.push('同一批次在归档中存在多个回滚回执。');
  const observationOwners = new Map<string, string>();
  for (const session of [...existing.postPublishBatchSessions, ...incoming.postPublishBatchSessions]) {
    for (const row of session.rows) {
      const owner = observationOwners.get(row.observationId);
      if (owner && owner !== session.id) blockers.push(`观察 ${row.observationId} 同时归属批次 ${owner} 与 ${session.id}。`);
      observationOwners.set(row.observationId, session.id);
    }
  }
  for (const session of incoming.postPublishBatchSessions) {
    const rollback = allRollbacks.get(session.id);
    for (const row of session.rows) {
      const presentIncoming = incomingObservations.has(row.observationId);
      const presentExisting = existingObservations.has(row.observationId);
      if (rollback && (presentIncoming || presentExisting)) blockers.push(`已回滚批次 ${session.id} 仍包含观察 ${row.observationId}，恢复会静默复活已撤销证据。`);
      if (!rollback && !presentIncoming) blockers.push(`活跃批次 ${session.id} 引用的观察 ${row.observationId} 未包含在归档中。`);
    }
  }
  for (const rollback of incoming.postPublishBatchRollbacks) {
    const session = incomingSessions.get(rollback.sessionId);
    if (!session) { blockers.push(`回滚回执 ${rollback.id} 引用的批次会话 ${rollback.sessionId} 缺失。`); continue; }
    const expected = session.rows.map((item) => item.observationId).sort();
    const actual = [...rollback.observationIds].sort();
    if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) blockers.push(`回滚回执 ${rollback.id} 未完整对应批次 ${session.id} 的全部观察。`);
  }
  return [...new Set(blockers)];
}

export async function previewProjectArchive(
  archive: ProjectArchive,
  currentProjectName: string,
  existing: ExistingArchiveCollections,
  inspections: ArchiveSourceInspection[] = [],
  now = new Date(),
): Promise<ProjectArchiveRestorePreview> {
  const archiveMetadata = { format: archive.format, version: archive.version, id: archive.id, createdAt: archive.createdAt, projectName: archive.projectName, policy: archive.policy };
  const values = { ...archive.sections, sourceReferences: archive.sourceReferences, archiveMetadata, ...(archive.version === PROJECT_ARCHIVE_SELECTIVE_VERSION ? { disclosurePolicy: archive.disclosure } : {}) } as Record<ProjectArchiveManifestSectionName, unknown>;
  const integrityErrors: string[] = [];
  for (const name of Object.keys(values) as ProjectArchiveManifestSectionName[]) {
    const actual = await digest(values[name]);
    const expected = archive.manifest.sections[name];
    if (!expected || expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) integrityErrors.push(`${name} 数据与归档清单不一致。`);
  }
  const checked = new Map(inspections.map((item) => [item.path.toLocaleLowerCase(), item]));
  const sourceResults = archive.sourceReferences.map((source) => {
    const inspection = checked.get(source.path.toLocaleLowerCase());
    let restoreStatus: 'verified' | 'available-unverified' | 'missing' | 'changed' = 'missing';
    if (inspection?.status === 'available') {
      if (inspection.size !== source.expectedSize || (source.quickSha256 && inspection.quickSha256 !== source.quickSha256)) restoreStatus = 'changed';
      else restoreStatus = source.quickSha256 && inspection.quickSha256 === source.quickSha256 ? 'verified' : 'available-unverified';
    }
    return { ...source, restoreStatus };
  });
  const conflicts = [
    ...collision(archive.sections.releaseCandidates, existing.releaseCandidates, 'RC'),
    ...collision(archive.sections.postPublishObservations, existing.postPublishObservations, '发布观察'),
    ...collision(archive.sections.postPublishExperiments, existing.postPublishExperiments, '实验结论'),
    ...collision(archive.sections.directorLearning, existing.directorLearning, '学习记录'),
    ...collision(archive.sections.postPublishBatchSessions ?? [], existing.postPublishBatchSessions, '批次会话'),
    ...collision(archive.sections.postPublishBatchRollbacks ?? [], existing.postPublishBatchRollbacks, '批次回滚回执'),
  ];
  const capacities = [
    ['RC', existing.releaseCandidates, archive.sections.releaseCandidates, 12],
    ['发布观察', existing.postPublishObservations, archive.sections.postPublishObservations, 100],
    ['实验结论', existing.postPublishExperiments, archive.sections.postPublishExperiments, 50],
    ['学习记录', existing.directorLearning, archive.sections.directorLearning, 300],
    ['批次会话', existing.postPublishBatchSessions, archive.sections.postPublishBatchSessions ?? [], 100],
    ['批次回滚回执', existing.postPublishBatchRollbacks, archive.sections.postPublishBatchRollbacks ?? [], 100],
  ] as const;
  const blockers = [...integrityErrors, ...conflicts, ...validateArchiveBatchCollections({
    postPublishObservations: archive.sections.postPublishObservations,
    postPublishBatchSessions: archive.sections.postPublishBatchSessions ?? [],
    postPublishBatchRollbacks: archive.sections.postPublishBatchRollbacks ?? [],
  }, existing)];
  for (const [label, current, incoming, limit] of capacities) {
    const unique = new Set([...current.map((item) => item.id), ...incoming.map((item) => item.id)]).size;
    if (unique > limit) blockers.push(`${label}合并后为 ${unique} 条，超过安全上限 ${limit}；为避免删除本机记录，已阻止恢复。`);
  }
  const warnings: string[] = [];
  const missing = sourceResults.filter((item) => item.restoreStatus === 'missing').length;
  const changed = sourceResults.filter((item) => item.restoreStatus === 'changed').length;
  const unchecked = sourceResults.filter((item) => item.restoreStatus === 'available-unverified').length;
  if (missing) warnings.push(`${missing} 条原片在归档路径上离线；工程可以恢复，但相关预览和渲染不可用。`);
  if (changed) warnings.push(`${changed} 条原片大小或快速哈希已变化；保留原路径并标记为错版，不自动替换。`);
  if (unchecked) warnings.push(`${unchecked} 条原片可访问但归档时没有快速哈希，只能核对文件大小。`);
  if (currentProjectName.trim()) warnings.push(`当前工程“${currentProjectName}”会先保存为恢复检查点；归档工程将以新名称打开。`);
  if (archive.version === 1) warnings.push('这是 v1 归档：没有批次会话与回滚回执数据段；系统不会补造缺失审计记录。');
  if (archive.version === PROJECT_ARCHIVE_SELECTIVE_VERSION && archive.disclosure) warnings.push(`这是${archive.disclosure.mode === 'minimal' ? '最小披露' : archive.disclosure.mode === 'full' ? '全量披露' : '自定义披露'}归档；主动排除：${archive.disclosure.omittedDomains.join('、') || '无'}。被主动排除的数据不视为缺失或损坏。`);
  return {
    archive,
    integrity: integrityErrors.length ? 'failed' : 'verified',
    integrityErrors,
    restoredProjectName: `${archive.projectName || '未命名视频'}（归档恢复副本 ${now.toISOString().slice(0, 10)}）`,
    currentProjectName,
    counts: {
      releaseCandidates: archive.sections.releaseCandidates.length,
      postPublishObservations: archive.sections.postPublishObservations.length,
      postPublishExperiments: archive.sections.postPublishExperiments.length,
      directorLearning: archive.sections.directorLearning.length,
      postPublishBatchSessions: archive.sections.postPublishBatchSessions?.length ?? 0,
      postPublishBatchRollbacks: archive.sections.postPublishBatchRollbacks?.length ?? 0,
    },
    sourceResults,
    conflicts,
    blockers,
    warnings,
  };
}

export function reviewArchiveSourceRelocation(source: ProjectArchiveRestorePreview['sourceResults'][number], candidate: ArchiveSourceInspection): ArchiveSourceRelocationReview {
  if (source.restoreStatus !== 'missing') throw new Error('只有归档原路径离线的素材可以重定位。');
  if (candidate.status !== 'available' || candidate.size === undefined || candidate.duration === undefined) throw new Error('候选文件当前不可读取或无法取得视频时长。');
  const size = candidate.size === source.expectedSize ? 'match' : 'mismatch';
  const duration = Math.abs(candidate.duration - source.duration) <= 0.5 ? 'match' : 'mismatch';
  const quickSha256 = !source.quickSha256 || !candidate.quickSha256 ? 'unavailable' : source.quickSha256 === candidate.quickSha256 ? 'match' : 'mismatch';
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (size === 'mismatch') blockers.push(`文件大小不一致：归档 ${source.expectedSize} bytes，候选 ${candidate.size} bytes。`);
  if (duration === 'mismatch') blockers.push(`视频时长不一致：归档 ${source.duration.toFixed(3)}s，候选 ${candidate.duration.toFixed(3)}s。`);
  if (quickSha256 === 'mismatch') blockers.push('候选文件的首尾快速哈希与归档记录不一致。');
  if (quickSha256 === 'unavailable') warnings.push('归档或候选缺少快速哈希，只能按文件大小和视频时长核对。');
  if (candidate.width !== undefined && candidate.height !== undefined && (candidate.width !== source.width || candidate.height !== source.height)) warnings.push(`画面尺寸不同：归档 ${source.width}×${source.height}，候选 ${candidate.width}×${candidate.height}。`);
  return { sourceId: source.id, originalPath: source.path, candidate: candidate as ArchiveSourceRelocationReview['candidate'], comparison: { size, duration, quickSha256 }, blockers, warnings };
}

export function confirmArchiveSourceRelocation(review: ArchiveSourceRelocationReview, confirmed: boolean, now = new Date()): ConfirmedArchiveSourceRelocation {
  if (review.blockers.length) throw new Error('候选文件与归档凭证不一致，不能建立重定位映射。');
  if (!confirmed) throw new Error('必须人工确认候选文件与这条归档原片的对应关系。');
  return { ...structuredClone(review), confirmedAt: now.toISOString() };
}

export function validateArchiveSourceRelocations(preview: ProjectArchiveRestorePreview, relocations: ConfirmedArchiveSourceRelocation[], inspections: ArchiveSourceInspection[]) {
  const sources = new Map(preview.sourceResults.map((item) => [item.id, item]));
  const checked = new Map(inspections.map((item) => [item.path.toLocaleLowerCase(), item]));
  const ids = new Set<string>();
  for (const relocation of relocations) {
    if (ids.has(relocation.sourceId)) throw new Error(`原片 ${relocation.sourceId} 存在重复重定位映射。`);
    ids.add(relocation.sourceId);
    const source = sources.get(relocation.sourceId);
    if (!source || source.path !== relocation.originalPath || source.restoreStatus !== 'missing') throw new Error(`原片 ${relocation.sourceId} 的归档状态已经变化，请重新预览。`);
    const inspection = checked.get(relocation.candidate.path.toLocaleLowerCase());
    if (!inspection) throw new Error(`重定位候选已无法核验：${relocation.candidate.path}`);
    const current = reviewArchiveSourceRelocation(source, inspection);
    if (current.blockers.length || current.candidate.size !== relocation.candidate.size || current.candidate.duration !== relocation.candidate.duration || current.candidate.quickSha256 !== relocation.candidate.quickSha256) {
      throw new Error(`重定位候选在确认后发生变化：${relocation.candidate.path}`);
    }
  }
}

export function createRecoveredProjectSnapshot(preview: ProjectArchiveRestorePreview, now = new Date(), relocations: ConfirmedArchiveSourceRelocation[] = []): ProjectSnapshot {
  if (preview.blockers.length) throw new Error(`恢复仍有 ${preview.blockers.length} 个阻断项。`);
  const snapshot = structuredClone(preview.archive.sections.project);
  snapshot.projectName = preview.restoredProjectName;
  snapshot.updatedAt = now.toISOString();
  const stateByPath = new Map(preview.sourceResults.map((item) => [item.path.toLocaleLowerCase(), item.restoreStatus]));
  const relocationById = new Map(relocations.map((item) => [item.sourceId, item]));
  snapshot.sourceMedia = (snapshot.sourceMedia ?? []).map((source) => {
    const relocation = relocationById.get(source.id);
    if (relocation) {
      if (relocation.originalPath !== source.path || relocation.blockers.length) throw new Error(`原片 ${source.name} 的重定位确认无效。`);
      const { proxyPath: _discardedProxy, ...withoutProxy } = source;
      return { ...withoutProxy, path: relocation.candidate.path, size: relocation.candidate.size, duration: relocation.candidate.duration, width: relocation.candidate.width ?? source.width, height: relocation.candidate.height ?? source.height, status: 'original' as const };
    }
    return { ...source, path: source.path, status: ['missing', 'changed'].includes(stateByPath.get(source.path.toLocaleLowerCase()) ?? '') ? 'missing' as const : source.status };
  });
  return snapshot;
}
