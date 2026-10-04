import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import type { ProjectSnapshot } from '@/types';
import { useUIStore } from './uiStore';
import { sourceRoughCutSignature } from '@/lib/sourceStoryAssembly';

const keys = ['canvas', 'blocks', 'assets', 'sourceMedia', 'storyAssembly', 'storyAssemblyVersions', 'externalClipInboxes', 'storyVersionSelection', 'projectName', 'narration', 'scenes', 'reviews', 'themeId', 'director'] as const;
type Document = Pick<ProjectSnapshot, typeof keys[number]>;
export const HISTORY_LIMIT = 50;
export const useEditorHistoryStore = create<{ undoCount: number; redoCount: number; revision: number; epoch: number; message: string }>(() => ({ undoCount: 0, redoCount: 0, revision: 0, epoch: 0, message: '' }));

/** Never resurrect working-copy approvals. Frozen versions are retained byte-for-byte. */
export function invalidateHistoryApprovals(document: Document): Document {
  const next: Document = {
    ...document,
    director: document.director ? { ...document.director, updatedAt: new Date().toISOString() } : undefined,
    storyAssembly: document.storyAssembly ? { ...document.storyAssembly, confirmedAt: undefined, preview: undefined } : undefined,
    sourceMedia: document.sourceMedia?.map((source) => ({ ...source, roughCutPlan: source.roughCutPlan ? {
      ...source.roughCutPlan,
      candidates: source.roughCutPlan.candidates.map((candidate) => ({ ...candidate, visualReview: undefined })),
      assembly: source.roughCutPlan.assembly ? { ...source.roughCutPlan.assembly, confirmedAt: undefined } : undefined,
    } : undefined })),
    externalClipInboxes: document.externalClipInboxes?.map((inbox) => inbox.savedVersionId ? inbox : ({ ...inbox, clips: inbox.clips.map((clip) => clip.decision === 'reject' ? clip : ({ ...clip, mappingStatus: 'pending' as const, boundaryConfirmed: false, visualStatus: 'pending' as const, decision: 'pending' as const })) })),
    reviews: document.reviews ? Object.fromEntries(Object.entries(document.reviews).map(([id, review]) => [id, { ...review, status: review.status === 'approved' ? 'changes' : review.status }])) : undefined,
  };
  next.sourceMedia = next.sourceMedia?.map((source) => source.roughCutPlan ? { ...source, roughCutPlan: { ...source.roughCutPlan,
    strategy: { ...source.roughCutPlan.strategy, directorUpdatedAt: next.director?.updatedAt } } } : source);
  if (next.storyAssembly) {
    next.storyAssembly = { ...next.storyAssembly, directorUpdatedAt: next.director?.updatedAt ?? next.storyAssembly.directorUpdatedAt,
      sourceSignatures: Object.fromEntries((next.sourceMedia ?? []).filter((source) => source.roughCutPlan?.candidates.some((candidate) => candidate.decision === 'keep')).map((source) => [source.id, sourceRoughCutSignature(source)])) };
  }
  return next;
}

let resetCurrent: (() => void) | undefined;
export function resetEditorHistory() { resetCurrent?.(); }

/** One synchronous UI operation is one step, even when it updates several store fields.
 * Entries share immutable document references; media bytes are never cloned into history.
 * History is session-local and excluded from snapshots, autosave, and RCs.
 */
export function installEditorHistory<T extends Document>(store: StoreApi<T>) {
  let past: Document[] = [];
  let future: Document[] = [];
  let pending: Document | undefined;
  let applying = false;
  let scheduled = false;
  let gesture = false;
  const capture = (state: T): Document => Object.fromEntries(keys.map((key) => [key, state[key]])) as Document;
  const publish = (message?: string) => useEditorHistoryStore.setState({ undoCount: past.length + (pending ? 1 : 0), redoCount: future.length, ...(message !== undefined ? { message } : {}) });
  const flush = () => {
    scheduled = false;
    if (gesture) return;
    if (pending) { past = [...past, pending].slice(-HISTORY_LIMIT); pending = undefined; }
    publish();
  };
  const reset = () => {
    gesture = false;
    past = []; future = []; pending = undefined;
    useEditorHistoryStore.setState((s) => ({ revision: s.revision + 1, epoch: s.epoch + 1 }));
    publish('');
  };
  resetCurrent = reset;
  store.subscribe((next, previous) => {
    if (applying || !keys.some((key) => next[key] !== previous[key])) return;
    pending ??= capture(previous);
    future = [];
    useEditorHistoryStore.setState((s) => ({ revision: s.revision + 1 }));
    publish('');
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
  });
  const travel = (direction: 'undo' | 'redo') => {
    gesture = false;
    flush();
    const source = direction === 'undo' ? past : future;
    const target = source[source.length - 1];
    if (!target) return false;
    const current = capture(store.getState());
    if (direction === 'undo') { past = past.slice(0, -1); future = [...future, current].slice(-HISTORY_LIMIT); }
    else { future = future.slice(0, -1); past = [...past, current].slice(-HISTORY_LIMIT); }
    applying = true;
    try {
      store.setState({ ...invalidateHistoryApprovals(target), voiceTimelineUndo: null } as unknown as Partial<T>);
      const ui = useUIStore.getState();
      ui.pause();
      if (!target.blocks.some((block) => block.id === ui.selectedId)) ui.selectBlock(null);
      const end = Math.max(0, ...target.blocks.map((block) => block.start + block.duration), ...target.scenes.map((scene) => scene.end));
      ui.setTime(Math.min(ui.currentTime, end));
    } finally { applying = false; }
    useEditorHistoryStore.setState((s) => ({ revision: s.revision + 1, epoch: s.epoch + 1 }));
    publish(`已${direction === 'undo' ? '撤销' : '重做'}。当前视觉、结构预演和审片确认需重新检查；冻结方案与 RC 历史不被改写。`);
    return true;
  };
  return { undo: () => travel('undo'), redo: () => travel('redo'), reset, flush,
    begin: () => { flush(); gesture = true; }, end: () => { gesture = false; flush(); } };
}
