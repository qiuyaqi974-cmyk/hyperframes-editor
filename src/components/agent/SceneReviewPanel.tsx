import { useEffect, useMemo, useState } from 'react';
import { reviewFor } from '@/lib/sceneReview';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';
import type { SceneReviewStatus } from '@/types';

const STATUS: Array<{ value: SceneReviewStatus; label: string; active: string }> = [
  { value: 'pending', label: '待审', active: 'border-slate-300/40 bg-slate-300/15 text-slate-100' },
  { value: 'approved', label: '通过', active: 'border-emerald-300/50 bg-emerald-300/15 text-emerald-100' },
  { value: 'changes', label: '修改', active: 'border-amber-300/50 bg-amber-300/15 text-amber-100' },
  { value: 'redo', label: '重做', active: 'border-red-300/50 bg-red-300/15 text-red-100' },
];

function clock(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export default function SceneReviewPanel() {
  const scenes = useEditorStore((state) => state.scenes);
  const reviews = useEditorStore((state) => state.reviews);
  const setStatus = useEditorStore((state) => state.setSceneReviewStatus);
  const addComment = useEditorStore((state) => state.addSceneReviewComment);
  const resolveComment = useEditorStore((state) => state.resolveSceneReviewComment);
  const currentTime = useUIStore((state) => state.currentTime);
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const selected = scenes.find((scene) => scene.id === selectedId) ?? scenes[0];
  const review = selected ? reviewFor(reviews, selected.id) : null;
  const counts = useMemo(() => {
    const result = { approved: 0, action: 0, unresolved: 0 };
    for (const scene of scenes) {
      const item = reviewFor(reviews, scene.id);
      if (item.status === 'approved') result.approved += 1;
      if (item.status === 'changes' || item.status === 'redo') result.action += 1;
      result.unresolved += item.comments.filter((comment) => !comment.resolved).length;
    }
    return result;
  }, [reviews, scenes]);

  useEffect(() => {
    if (!selectedId && scenes[0]) setSelectedId(scenes[0].id);
    if (selectedId && !scenes.some((scene) => scene.id === selectedId)) setSelectedId(scenes[0]?.id ?? '');
  }, [scenes, selectedId]);

  const selectScene = (sceneId: string) => {
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    setSelectedId(sceneId);
    useUIStore.getState().pause();
    useUIStore.getState().setTime(scene.start);
  };

  const changeStatus = (status: SceneReviewStatus) => {
    if (!selected) return;
    setStatus(selected.id, status);
    setMessage(status === 'approved' ? '已通过并锁定；后续 Agent 不得覆盖这个场景。' : status === 'changes' || status === 'redo' ? '场景已解锁，并加入交付阻断项。' : '已恢复为待审状态。');
  };

  const submitComment = () => {
    if (!selected || !draft.trim()) return;
    const time = Math.max(selected.start, Math.min(currentTime, selected.end));
    addComment(selected.id, time, draft);
    setDraft('');
    setMessage(`批注已钉在 ${clock(time)}。`);
  };

  return (
    <section className="rounded-lg border border-amber-300/20 bg-panel-2/70 p-2.5" aria-label="场景审片决策">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left">
        <span className="text-[11px] font-semibold text-ink">场景审片决策</span>
        <span className="rounded-full border border-stroke px-2 py-0.5 text-[9px] text-ink-dim">通过 {counts.approved}/{scenes.length}</span>
        {(counts.action > 0 || counts.unresolved > 0) && <span className="text-[9px] text-amber-200">待处理 {counts.action} · 批注 {counts.unresolved}</span>}
        <span className="ml-auto text-[11px] text-ink-faint">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-2.5 border-t border-stroke pt-2.5">
          {!scenes.length && <p className="text-[9.5px] leading-relaxed text-ink-faint">先建立场景或导入 SRT，才能逐场审片。</p>}
          {scenes.length > 0 && selected && review && (
            <>
              <div className="flex gap-1 overflow-x-auto pb-0.5">
                {scenes.map((scene, index) => {
                  const item = reviewFor(reviews, scene.id);
                  const tone = item.status === 'approved' ? 'bg-emerald-400' : item.status === 'changes' ? 'bg-amber-300' : item.status === 'redo' ? 'bg-red-400' : 'bg-slate-400';
                  return <button key={scene.id} type="button" onClick={() => selectScene(scene.id)} className={`relative min-w-8 rounded border px-2 py-1 text-[9.5px] ${scene.id === selected.id ? 'border-violet-300/50 bg-violet-300/10 text-violet-100' : 'border-stroke text-ink-faint'}`}><span className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${tone}`} />{index + 1}</button>;
                })}
              </div>
              <div className="rounded-md border border-stroke bg-panel/70 p-2">
                <div className="flex items-center justify-between text-[10px]"><span className="font-semibold text-ink-dim">场景 {selected.index || scenes.indexOf(selected) + 1}</span><button type="button" onClick={() => selectScene(selected.id)} className="font-mono text-cyan-200">{clock(selected.start)}–{clock(selected.end)}</button></div>
                <p className="mt-1 line-clamp-3 text-[9.5px] leading-relaxed text-ink-faint">{selected.text || '这个场景没有文字说明。'}</p>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {STATUS.map((item) => <button key={item.value} type="button" onClick={() => changeStatus(item.value)} className={`rounded border px-1 py-1.5 text-[9.5px] ${review.status === item.value ? item.active : 'border-stroke text-ink-faint hover:text-ink'}`}>{item.label}</button>)}
              </div>
              <div className="rounded-md border border-stroke bg-panel/50 p-2">
                <div className="mb-1.5 flex items-center justify-between text-[9.5px] text-ink-faint"><span>时间点批注</span><span className="font-mono text-cyan-200">当前 {clock(Math.max(selected.start, Math.min(currentTime, selected.end)))}</span></div>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder="具体说哪里要改，以及改成什么…" className="w-full resize-y rounded border border-stroke bg-panel px-2 py-1.5 text-[10px] leading-relaxed text-ink outline-none focus:border-amber-300/40" />
                <button type="button" onClick={submitComment} disabled={!draft.trim()} className="mt-1.5 w-full rounded bg-amber-500 px-2 py-1.5 text-[10px] font-medium text-white disabled:opacity-40">把批注钉在当前时间</button>
              </div>
              {review.comments.length > 0 && <div className="space-y-1.5">
                {review.comments.map((comment) => <div key={comment.id} className={`rounded-md border p-2 ${comment.resolved ? 'border-stroke bg-panel/30 opacity-60' : 'border-amber-300/25 bg-amber-300/[0.04]'}`}>
                  <div className="flex items-center gap-2"><button type="button" onClick={() => { useUIStore.getState().pause(); useUIStore.getState().setTime(comment.time); }} className="font-mono text-[9.5px] text-cyan-200">{clock(comment.time)}</button><span className="min-w-0 flex-1 text-[9.5px] leading-relaxed text-ink-dim">{comment.text}</span><button type="button" onClick={() => resolveComment(selected.id, comment.id, !comment.resolved)} className="shrink-0 rounded border border-stroke px-1.5 py-1 text-[9px] text-ink-faint">{comment.resolved ? '重新打开' : '解决'}</button></div>
                </div>)}
              </div>}
              {message && <p className="text-[9.5px] leading-relaxed text-amber-100/80">{message}</p>}
              <p className="text-[9px] leading-relaxed text-ink-faint">通过会锁定场景；修改和重做会解锁并阻止建立新 RC，直到重新通过或改回待审。</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
