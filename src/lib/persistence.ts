import type { ProjectSnapshot } from '@/types';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';
import type { PostPublishObservation } from '@/lib/postPublishFeedback';
import type { PostPublishExperimentReview } from '@/lib/postPublishExperiment';
import type { DirectorLearningRecord } from '@/lib/directorLearningLibrary';
import type { ConfirmedArchiveSourceRelocation, ExistingArchiveCollections, ProjectArchive, ProjectArchiveRestorePreview } from '@/lib/projectArchive';
import { validateArchiveBatchCollections } from '@/lib/projectArchive';
import type { PlatformMappingTemplate } from '@/lib/platformDataAdapter';
import {
  confirmPostPublishBatchRollback,
  createPostPublishBatchSession,
  previewPostPublishBatchRollback,
  type PostPublishBatchRollback,
  type PostPublishBatchSession,
  type PostPublishBatchSessionDraft,
} from '@/lib/postPublishBatchSession';
import type { DirectorLearningApplication } from '@/types';

const DB_NAME = 'hyperframes-editor-v3';
const STORE_NAME = 'projects';
const AUTOSAVE_KEY = 'autosave';
const RELEASE_CANDIDATES_KEY = 'release-candidates';
const POST_PUBLISH_FEEDBACK_KEY = 'post-publish-feedback';
const POST_PUBLISH_EXPERIMENTS_KEY = 'post-publish-experiments';
const DIRECTOR_LEARNING_KEY = 'director-learning-library';
const IMPORTED_ARCHIVES_KEY = 'imported-project-archives';
const RECOVERY_CHECKPOINTS_KEY = 'project-recovery-checkpoints';
const PLATFORM_MAPPING_TEMPLATES_KEY = 'platform-mapping-templates';
const POST_PUBLISH_BATCH_SESSIONS_KEY = 'post-publish-batch-sessions';
const POST_PUBLISH_BATCH_ROLLBACKS_KEY = 'post-publish-batch-rollbacks';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAutosave(snapshot: ProjectSnapshot): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(snapshot, AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadAutosave(): Promise<ProjectSnapshot | null> {
  const db = await openDb();
  const result = await new Promise<ProjectSnapshot | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(AUTOSAVE_KEY);
    request.onsuccess = () => resolve((request.result as ProjectSnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function saveReleaseCandidate(candidate: ReleaseCandidate): Promise<void> {
  const candidates = await loadReleaseCandidates();
  const next = [candidate, ...candidates.filter((item) => item.id !== candidate.id)].slice(0, 12);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(next, RELEASE_CANDIDATES_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadReleaseCandidates(): Promise<ReleaseCandidate[]> {
  const db = await openDb();
  const result = await new Promise<ReleaseCandidate[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(RELEASE_CANDIDATES_KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as ReleaseCandidate[] : []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

/** 发布后证据独立于冻结 RC 保存；更新采纳结论不会改写 RC。 */
export async function savePostPublishObservation(observation: PostPublishObservation): Promise<void> {
  await savePostPublishObservationsBatch([observation]);
}

export async function savePostPublishObservationsBatch(incomingObservations: PostPublishObservation[]): Promise<void> {
  const current = await loadPostPublishObservations();
  const incoming = new Map(incomingObservations.map((item) => [item.id, item]));
  const next = [...incoming.values(), ...current.filter((item) => !incoming.has(item.id))];
  if (next.length > 100) throw new Error(`发布观察合并后为 ${next.length} 条，超过安全上限 100。`);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(next, POST_PUBLISH_FEEDBACK_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadPostPublishObservations(): Promise<PostPublishObservation[]> {
  const db = await openDb();
  const result = await new Promise<PostPublishObservation[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(POST_PUBLISH_FEEDBACK_KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as PostPublishObservation[] : []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function savePostPublishExperiment(review: PostPublishExperimentReview): Promise<void> {
  const reviews = await loadPostPublishExperiments();
  const next = [review, ...reviews.filter((item) => item.id !== review.id)].slice(0, 50);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(next, POST_PUBLISH_EXPERIMENTS_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadPostPublishExperiments(): Promise<PostPublishExperimentReview[]> {
  const db = await openDb();
  const result = await new Promise<PostPublishExperimentReview[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(POST_PUBLISH_EXPERIMENTS_KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as PostPublishExperimentReview[] : []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function saveDirectorLearningRecords(records: DirectorLearningRecord[]): Promise<void> {
  const current = await loadDirectorLearningRecords();
  const incoming = new Map(records.map((item) => [item.id, item]));
  const next = [...incoming.values(), ...current.filter((item) => !incoming.has(item.id))]
    .sort((a, b) => Date.parse(b.provenance.sourceConfirmedAt) - Date.parse(a.provenance.sourceConfirmedAt)).slice(0, 300);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(next, DIRECTOR_LEARNING_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDirectorLearningRecords(): Promise<DirectorLearningRecord[]> {
  const db = await openDb();
  const result = await new Promise<DirectorLearningRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(DIRECTOR_LEARNING_KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as DirectorLearningRecord[] : []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function getValue<T>(key: string, fallback: T): Promise<T> {
  const db = await openDb();
  const result = await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? fallback);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function putValues(entries: Array<[string, unknown]>) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const [key, value] of entries) tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function loadPlatformMappingTemplates(): Promise<PlatformMappingTemplate[]> {
  return getValue(PLATFORM_MAPPING_TEMPLATES_KEY, []);
}

export async function savePlatformMappingTemplate(template: PlatformMappingTemplate) {
  const current = await loadPlatformMappingTemplates();
  const next = [template, ...current.filter((item) => item.id !== template.id)].slice(0, 20);
  await putValues([[PLATFORM_MAPPING_TEMPLATES_KEY, next]]);
}

export async function deletePlatformMappingTemplate(id: string) {
  const current = await loadPlatformMappingTemplates();
  await putValues([[PLATFORM_MAPPING_TEMPLATES_KEY, current.filter((item) => item.id !== id)]]);
}

export function loadPostPublishBatchSessions(): Promise<PostPublishBatchSession[]> {
  return getValue(POST_PUBLISH_BATCH_SESSIONS_KEY, []);
}

export function loadPostPublishBatchRollbacks(): Promise<PostPublishBatchRollback[]> {
  return getValue(POST_PUBLISH_BATCH_ROLLBACKS_KEY, []);
}

/** Writes every observation and its immutable import receipt in one IndexedDB transaction. */
export async function savePostPublishObservationBatchSession(observations: PostPublishObservation[], draft: PostPublishBatchSessionDraft, now = new Date()) {
  const [current, sessions] = await Promise.all([loadPostPublishObservations(), loadPostPublishBatchSessions()]);
  if (sessions.length >= 100) throw new Error('批次导入会话已达到安全上限 100；请先导出审计资料再继续。');
  const incoming = new Map(observations.map((item) => [item.id, item]));
  if (incoming.size !== observations.length) throw new Error('批次包含重复观察 ID。');
  const nextObservations = [...incoming.values(), ...current.filter((item) => !incoming.has(item.id))];
  if (nextObservations.length > 100) throw new Error(`发布观察合并后为 ${nextObservations.length} 条，超过安全上限 100。`);
  const session = createPostPublishBatchSession(observations, draft, sessions, now);
  await putValues([
    [POST_PUBLISH_FEEDBACK_KEY, nextObservations],
    [POST_PUBLISH_BATCH_SESSIONS_KEY, [session, ...sessions]],
  ]);
  return session;
}

/** Re-checks all downstream evidence immediately before atomically removing the complete batch. */
export async function rollbackPostPublishBatchSession(sessionId: string, applications: DirectorLearningApplication[], confirmed: boolean, reason: string, now = new Date()) {
  const [sessions, rollbacks, observations, experiments, learningRecords, candidates] = await Promise.all([
    loadPostPublishBatchSessions(), loadPostPublishBatchRollbacks(), loadPostPublishObservations(), loadPostPublishExperiments(), loadDirectorLearningRecords(), loadReleaseCandidates(),
  ]);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error('找不到批次导入会话。');
  if (rollbacks.length >= 100) throw new Error('批次回滚回执已达到安全上限 100；为避免丢失审计记录，已阻止操作。');
  const frozenApplications = candidates.flatMap((item) => item.snapshot.director?.learningApplications ?? []);
  const preview = previewPostPublishBatchRollback(session, sessions, rollbacks, observations, experiments, learningRecords, [...applications, ...frozenApplications]);
  const rollback = confirmPostPublishBatchRollback(preview, confirmed, reason, rollbacks, now);
  const observationIds = new Set(rollback.observationIds);
  const nextObservations = observations.filter((item) => !observationIds.has(item.id));
  if (observations.length - nextObservations.length !== rollback.observationIds.length) throw new Error('批次观察数量在确认后变化，请重新检查影响清单。');
  await putValues([
    [POST_PUBLISH_FEEDBACK_KEY, nextObservations],
    [POST_PUBLISH_BATCH_ROLLBACKS_KEY, [rollback, ...rollbacks]],
  ]);
  return { rollback, observations: nextObservations };
}

export interface ImportedProjectArchive {
  archive: ProjectArchive;
  importedAt: string;
  sourceResults: ProjectArchiveRestorePreview['sourceResults'];
  sourceRelocations?: ConfirmedArchiveSourceRelocation[];
}

export async function saveImportedProjectArchive(entry: ImportedProjectArchive) {
  const current = await loadImportedProjectArchives();
  await putValues([[IMPORTED_ARCHIVES_KEY, [entry, ...current.filter((item) => item.archive.id !== entry.archive.id)].slice(0, 20)]]);
}

export function loadImportedProjectArchives(): Promise<ImportedProjectArchive[]> {
  return getValue(IMPORTED_ARCHIVES_KEY, []);
}

export async function saveRecoveryCheckpoint(snapshot: ProjectSnapshot, now = new Date()) {
  const current = await loadRecoveryCheckpoints();
  await putValues([[RECOVERY_CHECKPOINTS_KEY, [{ id: `checkpoint-${now.getTime().toString(36)}`, savedAt: now.toISOString(), snapshot }, ...current].slice(0, 20)]]);
}

export function loadRecoveryCheckpoints(): Promise<Array<{ id: string; savedAt: string; snapshot: ProjectSnapshot }>> {
  return getValue(RECOVERY_CHECKPOINTS_KEY, []);
}

function mergeWithoutOverwrite<T extends { id: string }>(current: T[], incoming: T[], label: string, limit: number) {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = map.get(item.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw new Error(`${label} ${item.id} 与本机记录冲突，已停止恢复。`);
    if (!existing) map.set(item.id, item);
  }
  if (map.size > limit) throw new Error(`${label}合并后超过安全上限 ${limit}，已停止恢复。`);
  return [...map.values()];
}

export async function restoreArchiveCollections(incoming: ExistingArchiveCollections) {
  const current: ExistingArchiveCollections = {
    releaseCandidates: await loadReleaseCandidates(),
    postPublishObservations: await loadPostPublishObservations(),
    postPublishExperiments: await loadPostPublishExperiments(),
    directorLearning: await loadDirectorLearningRecords(),
    postPublishBatchSessions: await loadPostPublishBatchSessions(),
    postPublishBatchRollbacks: await loadPostPublishBatchRollbacks(),
  };
  const batchBlockers = validateArchiveBatchCollections(incoming, current);
  if (batchBlockers.length) throw new Error(batchBlockers.join('；'));
  const merged: ExistingArchiveCollections = {
    releaseCandidates: mergeWithoutOverwrite(current.releaseCandidates, incoming.releaseCandidates, 'RC', 12),
    postPublishObservations: mergeWithoutOverwrite(current.postPublishObservations, incoming.postPublishObservations, '发布观察', 100),
    postPublishExperiments: mergeWithoutOverwrite(current.postPublishExperiments, incoming.postPublishExperiments, '实验结论', 50),
    directorLearning: mergeWithoutOverwrite(current.directorLearning, incoming.directorLearning, '学习记录', 300),
    postPublishBatchSessions: mergeWithoutOverwrite(current.postPublishBatchSessions, incoming.postPublishBatchSessions, '批次会话', 100),
    postPublishBatchRollbacks: mergeWithoutOverwrite(current.postPublishBatchRollbacks, incoming.postPublishBatchRollbacks, '批次回滚回执', 100),
  };
  await putValues([
    [RELEASE_CANDIDATES_KEY, merged.releaseCandidates],
    [POST_PUBLISH_FEEDBACK_KEY, merged.postPublishObservations],
    [POST_PUBLISH_EXPERIMENTS_KEY, merged.postPublishExperiments],
    [DIRECTOR_LEARNING_KEY, merged.directorLearning],
    [POST_PUBLISH_BATCH_SESSIONS_KEY, merged.postPublishBatchSessions],
    [POST_PUBLISH_BATCH_ROLLBACKS_KEY, merged.postPublishBatchRollbacks],
  ]);
}
