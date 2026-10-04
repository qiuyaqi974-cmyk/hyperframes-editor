import { useEffect, useMemo, useState } from 'react';
import { actionEntryIsCurrent, actionSourceSignature } from '@/lib/sourceActionIndex';
import { useEditorHistoryStore } from '@/store/editorHistory';
import { adjustRoughCutPadding, applyRoughCutSuggestion, createSourceRoughCutPlan, roughCutPlanReadiness, updateRoughCutDecision } from '@/lib/roughCutPlan';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';
import type { ExternalMediaSource, RoughCutCandidateDecision } from '@/types';
import { waveformWindowPeaks, type SourceVisualCheckpointResult } from '@/lib/sourceVisualCheckpoint';
import RoughCutStructurePanel from './RoughCutStructurePanel';

interface Props {
  source: ExternalMediaSource;
  onSeek: (time: number) => void;
  onMessage: (message: string) => void;
  generateVisualCheckpoint?: (start: number, end: number) => Promise<SourceVisualCheckpointResult>;
}

function clock(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const decisionLabel: Record<RoughCutCandidateDecision, string> = { review: '待审', keep: '保留', drop: '排除' };

export default function RoughCutReviewPanel({ source, onSeek, onMessage, generateVisualCheckpoint }: Props) {
  const director = useEditorStore((state) => state.director);
  const updateSourceMedia = useEditorStore((state) => state.updateSourceMedia);
  const addSourceClip = useEditorStore((state) => state.addSourceClip);
  const removeBlock = useEditorStore((state) => state.removeBlock);
  const [filter, setFilter] = useState<RoughCutCandidateDecision | 'all'>('all');
  const [query, setQuery] = useState('');
  const [visualBusyId, setVisualBusyId] = useState('');
  const [visuals, setVisuals] = useState<Record<string, SourceVisualCheckpointResult>>({});
  const historyEpoch = useEditorHistoryStore((s) => s.epoch);
  useEffect(() => { setVisuals({}); }, [historyEpoch]);
  const plan = source.roughCutPlan;
  const candidates = plan?.candidates ?? [];
  const readiness = useMemo(() => plan ? roughCutPlanReadiness(plan, director.updatedAt) : { kept: [], unchecked: [], missingRoles: [], overlapPairs: [], structureComplete: false, structureConfirmed: false, directorStale: false, duration: 0, ready: false }, [plan, director.updatedAt]);
  const kept = readiness.kept;
  const keptDuration = readiness.duration;
  const uncheckedKept = readiness.unchecked;
  const visible = candidates.filter((candidate) =>
    (filter === 'all' || candidate.decision === filter)
    && (!query.trim() || candidate.text.toLowerCase().includes(query.trim().toLowerCase())),
  ).slice(0, 160);

  const generate = () => {
    if (!source.transcript?.length && !source.eventMarkers?.length) return;
    if (visualBusyId) return;
    if (plan?.appliedBlockIds?.length) {
      onMessage('请先撤销已追加的粗剪，再重新生成候选，避免清单与时间轴失配。');
      return;
    }
    const next = createSourceRoughCutPlan(source.id, source.duration, source.transcript ?? [], director, { markers: source.eventMarkers?.filter((marker) => actionEntryIsCurrent(source, marker)), markerSourceSignature: actionSourceSignature(source) });
    updateSourceMedia(source.id, { roughCutPlan: next });
    const first = next.candidates[0];
    const boundary = first?.origin === 'event' ? '人工动作' : first?.boundary === 'word' ? '逐词边界' : '字幕段边界';
    onMessage(`已生成 ${next.candidates.length} 个${boundary}候选。当前只是审片清单，尚未修改时间轴。`);
  };

  const decide = (candidateId: string, decision: RoughCutCandidateDecision) => {
    if (!plan) return;
    if (visualBusyId) return;
    if (plan.appliedBlockIds?.length) {
      onMessage('这份粗剪已经写入时间轴；请先撤销本次追加，再修改保留决定。');
      return;
    }
    updateSourceMedia(source.id, { roughCutPlan: { ...updateRoughCutDecision(plan, candidateId, decision), appliedAt: undefined, appliedBlockIds: undefined } });
  };

  const decideAll = (decision: RoughCutCandidateDecision) => {
    if (!plan) return;
    if (visualBusyId) return;
    if (plan.appliedBlockIds?.length) {
      onMessage('这份粗剪已经写入时间轴；请先撤销本次追加，再批量修改。');
      return;
    }
    let next = plan;
    for (const candidate of plan.candidates) next = updateRoughCutDecision(next, candidate.id, decision);
    updateSourceMedia(source.id, { roughCutPlan: { ...next, appliedAt: undefined, appliedBlockIds: undefined } });
  };

  const acceptSuggestion = (candidateId: string) => {
    if (!plan || visualBusyId || plan.appliedBlockIds?.length) return;
    updateSourceMedia(source.id, { roughCutPlan: { ...applyRoughCutSuggestion(plan, candidateId), appliedAt: undefined, appliedBlockIds: undefined } });
    onMessage('已采纳这条联合建议；仍需检查画面、确认叙事结构并完成预演。');
  };

  const appendToTimeline = () => {
    if (!plan || !readiness.ready) return;
    let cursor = useUIStore.getState().currentTime;
    const blockIds: string[] = [];
    for (const candidate of kept) {
      useUIStore.getState().setTime(cursor);
      blockIds.push(addSourceClip(source.id, candidate.start, candidate.end));
      cursor += candidate.end - candidate.start;
    }
    useUIStore.getState().setTime(cursor);
    updateSourceMedia(source.id, { roughCutPlan: { ...plan, appliedAt: new Date().toISOString(), appliedBlockIds: blockIds } });
    onMessage(`已按确认的导演结构追加 ${kept.length} 个片段，共 ${clock(keptDuration)}。原片没有被改写。`);
  };

  const inspectVisual = async (candidateId: string, start: number, end: number) => {
    if (!plan || !generateVisualCheckpoint || visualBusyId) return;
    const revision = useEditorHistoryStore.getState().revision;
    setVisualBusyId(candidateId);
    onMessage('正在按需提取入点、正文和出点附近的 9 帧；不会扫描整条原片…');
    try {
      const checkpoint = await generateVisualCheckpoint(start, end);
      if (useEditorHistoryStore.getState().revision !== revision) throw new Error('工程已编辑或撤销，请重新生成视觉检查图。');
      setVisuals((current) => ({ ...current, [candidateId]: checkpoint }));
      updateSourceMedia(source.id, {
        roughCutPlan: {
          ...plan,
          candidates: plan.candidates.map((candidate) => candidate.id === candidateId ? {
            ...candidate,
            visualReview: { status: 'reviewing', checkedAt: new Date().toISOString(), windowStart: checkpoint.windowStart, windowEnd: checkpoint.windowEnd },
          } : candidate),
        },
      });
      onSeek(start);
      onMessage(`视觉检查图已生成${checkpoint.cached ? '（缓存命中）' : ''}；请结合源视频播放确认边界。`);
    } catch (error) {
      onMessage(`视觉检查失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setVisualBusyId('');
    }
  };

  const setVisualStatus = (candidateId: string, status: 'approved' | 'adjust') => {
    if (!plan) return;
    const checkpoint = visuals[candidateId];
    const existing = plan.candidates.find((candidate) => candidate.id === candidateId)?.visualReview;
    if (!checkpoint && !existing) return;
    updateSourceMedia(source.id, {
      roughCutPlan: {
        ...plan,
        candidates: plan.candidates.map((candidate) => candidate.id === candidateId ? {
          ...candidate,
          visualReview: {
            status,
            checkedAt: new Date().toISOString(),
            windowStart: checkpoint?.windowStart ?? existing?.windowStart ?? candidate.start,
            windowEnd: checkpoint?.windowEnd ?? existing?.windowEnd ?? candidate.end,
          },
        } : candidate),
      },
    });
  };

  const adjustPadding = (candidateId: string, edge: 'start' | 'end', delta: number) => {
    if (!plan || !source.transcript) return;
    const adjusted = adjustRoughCutPadding(plan, candidateId, edge, delta, source.transcript, source.duration);
    updateSourceMedia(source.id, { roughCutPlan: adjusted });
    setVisuals((current) => {
      const next = { ...current };
      delete next[candidateId];
      return next;
    });
    onMessage('已按逐词边界调整 50ms 安全余量，请重新检查画面。');
  };

  const undoAppend = () => {
    if (!plan?.appliedBlockIds?.length) return;
    plan.appliedBlockIds.forEach(removeBlock);
    updateSourceMedia(source.id, { roughCutPlan: { ...plan, appliedAt: undefined, appliedBlockIds: undefined } });
    onMessage('已撤销这次粗剪追加；候选保留/排除决定仍然保存。');
  };

  return (
    <div className="rounded-md border border-amber-300/20 bg-amber-300/[0.035] p-2">
      <div className="flex items-start justify-between gap-2">
        <div><h4 className="text-[10px] font-semibold text-amber-100">可审粗剪候选</h4><p className="mt-0.5 text-[8.5px] leading-relaxed text-ink-faint">按说话边界拆句，并只用来源仍有效的人工视觉语义生成待审建议。采纳建议后仍须看画面、确认结构和预演。</p></div>
        <button type="button" onClick={generate} disabled={(!source.transcript?.length && !source.eventMarkers?.length) || Boolean(visualBusyId)} className="shrink-0 rounded border border-amber-300/30 px-2 py-1 text-[9px] text-amber-100 disabled:opacity-40">{plan ? '重新生成' : '生成候选'}</button>
      </div>
      {plan && <>
        <div className="mt-1.5 rounded border border-stroke bg-panel/50 px-2 py-1.5 text-[8.5px] leading-relaxed text-ink-faint">
          导演上下文：{plan.strategy.objective || '未填写目标'} · {plan.strategy.pacing === 'fast' ? '快节奏' : plan.strategy.pacing === 'calm' ? '舒缓节奏' : '平衡节奏'} · 停顿阈值 {plan.strategy.pauseThreshold.toFixed(2)}s<br />
          已保留 {kept.length}/{candidates.length} 段 · 待视觉确认 {uncheckedKept.length} 段 · 重叠冲突 {readiness.overlapPairs.length} 处 · 预计成片 {clock(keptDuration)}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button type="button" onClick={() => decideAll('keep')} disabled={Boolean(visualBusyId)} className="rounded border border-emerald-300/25 px-1.5 py-1 text-[8.5px] text-emerald-200 disabled:opacity-40">全部标为保留</button>
          <button type="button" onClick={() => decideAll('review')} disabled={Boolean(visualBusyId)} className="rounded border border-stroke px-1.5 py-1 text-[8.5px] text-ink-faint disabled:opacity-40">全部退回待审</button>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛台词" className="min-w-20 flex-1 rounded border border-stroke bg-panel px-1.5 py-1 text-[8.5px] text-ink outline-none" />
          <select value={filter} onChange={(event) => setFilter(event.target.value as RoughCutCandidateDecision | 'all')} className="rounded border border-stroke bg-panel px-1.5 py-1 text-[8.5px] text-ink"><option value="all">全部</option><option value="review">待审</option><option value="keep">保留</option><option value="drop">排除</option></select>
        </div>
        <div className="mt-1.5 max-h-64 space-y-1 overflow-y-auto">
          {visible.map((candidate) => {
            const visual = visuals[candidate.id];
            const localPeaks = waveformWindowPeaks(source.waveform?.peaks ?? [], source.duration, visual?.windowStart ?? candidate.start, visual?.windowEnd ?? candidate.end);
            return <div key={candidate.id} className={`rounded border p-1.5 ${candidate.decision === 'keep' ? 'border-emerald-300/25 bg-emerald-300/[0.04]' : candidate.decision === 'drop' ? 'border-red-300/20 bg-red-300/[0.03] opacity-65' : 'border-stroke bg-panel/60'}`}>
            <div className="flex items-start gap-1.5"><button type="button" onClick={() => onSeek(candidate.start)} className="shrink-0 font-mono text-[8.5px] text-cyan-200">{clock(candidate.start)}–{clock(candidate.end)}</button><span className={`shrink-0 rounded px-1 py-0.5 text-[7px] ${candidate.origin === 'event' ? 'bg-fuchsia-300/10 text-fuchsia-100' : 'bg-cyan-300/10 text-cyan-100'}`}>{candidate.origin === 'event' ? '人工动作' : '语音'}</span><span className="min-w-0 flex-1 text-[9px] leading-relaxed text-ink-dim">{candidate.text}</span></div>
            <div className="mt-1 flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-[7.5px] text-ink-faint">{candidate.reason}</span><button type="button" disabled={!generateVisualCheckpoint || Boolean(visualBusyId)} onClick={() => void inspectVisual(candidate.id, candidate.start, candidate.end)} className="rounded border border-cyan-300/25 px-1.5 py-0.5 text-[8px] text-cyan-100 disabled:opacity-40">{visualBusyId === candidate.id ? '提取中…' : candidate.visualReview ? '重看画面' : '检查画面'}</button>{(['review', 'keep', 'drop'] as const).map((decision) => <button key={decision} type="button" disabled={Boolean(visualBusyId)} onClick={() => decide(candidate.id, decision)} className={`rounded px-1.5 py-0.5 text-[8px] disabled:opacity-40 ${candidate.decision === decision ? decision === 'keep' ? 'bg-emerald-500 text-white' : decision === 'drop' ? 'bg-red-500 text-white' : 'bg-slate-500 text-white' : 'border border-stroke text-ink-faint'}`}>{decisionLabel[decision]}</button>)}</div>
            {candidate.suggestion && <div className="mt-1 flex items-start gap-1 rounded border border-violet-300/20 bg-violet-300/[0.04] px-1.5 py-1 text-[7.5px] text-violet-100"><span className="min-w-0 flex-1">联合建议：{decisionLabel[candidate.suggestion.decision]}{candidate.suggestion.narrativeRole ? ` · ${candidate.suggestion.narrativeRole}` : ''}。{candidate.suggestion.reason}</span><button type="button" disabled={Boolean(visualBusyId) || Boolean(plan.appliedBlockIds?.length)} onClick={() => acceptSuggestion(candidate.id)} className="shrink-0 rounded border border-violet-300/30 px-1.5 py-0.5 text-[8px] disabled:opacity-40">采纳</button></div>}
            {candidate.visualReview && <p className={`mt-1 text-[7.5px] ${candidate.visualReview.status === 'approved' ? 'text-emerald-200' : candidate.visualReview.status === 'adjust' ? 'text-red-200' : 'text-amber-100'}`}>视觉状态：{candidate.visualReview.status === 'approved' ? '画面通过' : candidate.visualReview.status === 'adjust' ? '边界需调整' : '检查中，尚未确认'}</p>}
            {candidate.visualReview?.status === 'adjust' && candidate.boundary === 'word' && <div className="mt-1 grid grid-cols-2 gap-1 text-[7.5px]"><div className="flex gap-1"><button type="button" onClick={() => adjustPadding(candidate.id, 'start', 0.05)} className="flex-1 rounded border border-stroke px-1 py-0.5 text-ink-faint">入点多留50ms</button><button type="button" onClick={() => adjustPadding(candidate.id, 'start', -0.05)} className="flex-1 rounded border border-stroke px-1 py-0.5 text-ink-faint">入点少留50ms</button></div><div className="flex gap-1"><button type="button" onClick={() => adjustPadding(candidate.id, 'end', -0.05)} className="flex-1 rounded border border-stroke px-1 py-0.5 text-ink-faint">出点少留50ms</button><button type="button" onClick={() => adjustPadding(candidate.id, 'end', 0.05)} className="flex-1 rounded border border-stroke px-1 py-0.5 text-ink-faint">出点多留50ms</button></div></div>}
            {candidate.visualReview?.status === 'adjust' && candidate.boundary !== 'word' && <p className="mt-1 text-[7.5px] text-red-200/80">{candidate.boundary === 'manual' ? '人工动作请回到上方修改动作标记区间。' : '外部字幕没有逐词边界，请回到源播放器重新打入点/出点，不能安全自动微调。'}</p>}
            {visual && <div className="mt-1.5 overflow-hidden rounded border border-cyan-300/15 bg-black/60 p-1">
              <p className="mb-0.5 text-center text-[7px] text-cyan-100/75">三行依次为：入点附近 / 正文中部 / 出点附近</p><div className="mb-1 grid grid-cols-3 text-center text-[7px] text-ink-faint"><span>前 0.45s</span><span>中心帧</span><span>后 0.45s</span></div>
              <img src={visual.image} alt="入点、正文中部与出点附近的九帧视觉检查图" className="w-full rounded" />
              {localPeaks.length > 0 && <div className="mt-1 flex h-7 items-center gap-px overflow-hidden rounded bg-slate-950 px-1">{localPeaks.map((peak, index) => <span key={index} className="min-w-px flex-1 rounded-full bg-cyan-300/60" style={{ height: `${Math.max(2, peak * 22)}px` }} />)}</div>}
              <div className="mt-1 flex gap-1"><button type="button" onClick={() => { onSeek(candidate.start); setVisualStatus(candidate.id, 'approved'); }} className="flex-1 rounded bg-emerald-600 px-1.5 py-1 text-[8.5px] text-white">画面与边界通过</button><button type="button" onClick={() => { onSeek(candidate.start); setVisualStatus(candidate.id, 'adjust'); }} className="flex-1 rounded border border-red-300/25 px-1.5 py-1 text-[8.5px] text-red-200">边界需调整</button></div>
            </div>}
          </div>})}
          {visible.length < candidates.filter((candidate) => (filter === 'all' || candidate.decision === filter) && (!query.trim() || candidate.text.toLowerCase().includes(query.trim().toLowerCase()))).length && <p className="py-1 text-center text-[8px] text-ink-faint">候选较多，当前显示前 160 条；可用台词或状态筛选。</p>}
        </div>
        <RoughCutStructurePanel source={source} onMessage={onMessage} />
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" onClick={appendToTimeline} disabled={!readiness.ready} title={readiness.directorStale ? '导演 Brief 已变化，请先同步并重新确认结构' : readiness.missingRoles.length ? `还有 ${readiness.missingRoles.length} 段未指定叙事职责` : !readiness.structureConfirmed ? '请先确认导演结构' : uncheckedKept.length ? `还有 ${uncheckedKept.length} 个保留片段未通过视觉检查` : readiness.overlapPairs.length ? `还有 ${readiness.overlapPairs.length} 处保留片段重叠` : undefined} className="flex-1 rounded bg-amber-500 px-2 py-1.5 text-[9.5px] font-medium text-slate-950 disabled:opacity-40">{plan.appliedBlockIds?.length ? '已追加到时间轴' : readiness.directorStale ? '先同步当前导演 Brief' : readiness.missingRoles.length ? `还需分配 ${readiness.missingRoles.length} 段职责` : !readiness.structureConfirmed ? '先确认导演结构' : uncheckedKept.length ? `还需检查 ${uncheckedKept.length} 段画面` : readiness.overlapPairs.length ? `先解决 ${readiness.overlapPairs.length} 处重叠` : `按导演结构追加 ${kept.length} 段`}</button>
          {plan.appliedBlockIds?.length ? <button type="button" onClick={undoAppend} className="rounded border border-red-300/25 px-2 py-1.5 text-[9px] text-red-200">撤销本次追加</button> : null}
        </div>
      </>}
    </div>
  );
}
