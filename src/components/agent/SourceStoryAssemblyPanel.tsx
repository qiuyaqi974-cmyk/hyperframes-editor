import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applySourceStoryTemplate,
  assignSourceStoryRole,
  confirmSourceStoryAssembly,
  createSourceStoryAssembly,
  moveSourceStoryItem,
  refreshSourceStoryAssembly,
  removeSourceStoryItem,
  replaceSourceStoryItem,
  reviseSourceStoryBoundary,
  sourceStoryAssemblyReadiness,
} from '@/lib/sourceStoryAssembly';
import { acceptedRoughCutCandidates } from '@/lib/roughCutPlan';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';
import type { NarrativeRole, SourceStoryAssembly } from '@/types';
import type { SourceStoryPreviewProgress, SourceStoryPreviewRequest, SourceStoryPreviewResult } from '@/lib/sourceStoryPreview';
import type { SourceVisualCheckpointResult } from '@/lib/sourceVisualCheckpoint';
import SourceStoryVersionPanel from './SourceStoryVersionPanel';
import { useEditorHistoryStore } from '@/store/editorHistory';

interface Props { onMessage: (message: string) => void }

interface StoryPreviewBridge {
  registerSourceMedia: (path: string) => Promise<{ url: string }>;
  generateSourceStoryPreview: (request: SourceStoryPreviewRequest) => Promise<SourceStoryPreviewResult & { url: string }>;
  cancelSourceStoryPreview: (jobId: string) => Promise<{ canceled: boolean }>;
  onSourceStoryPreviewProgress: (listener: (progress: SourceStoryPreviewProgress) => void) => () => void;
  generateSourceVisualCheckpoint: (path: string, start: number, end: number) => Promise<SourceVisualCheckpointResult>;
}

const roles: Array<{ value: NarrativeRole; label: string }> = [
  { value: 'hook', label: '开场钩子' }, { value: 'context', label: '背景 / 准备' },
  { value: 'argument', label: '核心步骤 / 观点' }, { value: 'proof', label: '证明 / 结果' },
  { value: 'turn', label: '转折' }, { value: 'cta', label: '结尾行动' }, { value: 'custom', label: '自定义职责' },
];

function clock(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
}

export default function SourceStoryAssemblyPanel({ onMessage }: Props) {
  const sources = useEditorStore((state) => state.sourceMedia);
  const director = useEditorStore((state) => state.director);
  const assembly = useEditorStore((state) => state.storyAssembly);
  const setAssembly = useEditorStore((state) => state.setStoryAssembly);
  const updateSourceMedia = useEditorStore((state) => state.updateSourceMedia);
  const addSourceClip = useEditorStore((state) => state.addSourceClip);
  const removeBlock = useEditorStore((state) => state.removeBlock);
  const [previewJobId, setPreviewJobId] = useState('');
  const [previewProgress, setPreviewProgress] = useState<SourceStoryPreviewProgress>();
  const [previewUrl, setPreviewUrl] = useState('');
  const [boundaryBusy, setBoundaryBusy] = useState(-1);
  const [boundaryImages, setBoundaryImages] = useState<Record<number, string>>({});
  const historyEpoch = useEditorHistoryStore((s) => s.epoch);
  useEffect(() => { setBoundaryImages({}); }, [historyEpoch]);
  const [replacementTarget, setReplacementTarget] = useState(-1);
  const [replacementQuery, setReplacementQuery] = useState('');
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const bridge = (window as Window & { hyperframesElectron?: StoryPreviewBridge }).hyperframesElectron;
  const eligible = useMemo(() => sources.filter((source) => source.roughCutPlan && acceptedRoughCutCandidates(source.roughCutPlan).length), [sources]);
  const readiness = useMemo(() => assembly ? sourceStoryAssemblyReadiness(assembly, sources, director.updatedAt) : null, [assembly, sources, director.updatedAt]);
  const replacements = useMemo(() => {
    const used = new Set((assembly?.items ?? []).map((item) => `${item.sourceId}:${item.candidateId}`));
    return sources.flatMap((source) => source.roughCutPlan ? acceptedRoughCutCandidates(source.roughCutPlan)
      .filter((candidate) => !used.has(`${source.id}:${candidate.id}`))
      .map((candidate) => ({ source, candidate })) : []);
  }, [assembly?.items, sources]);
  const visibleReplacements = useMemo(() => {
    const query = replacementQuery.trim().toLowerCase();
    return replacements.filter(({ source, candidate }) => !query || `${source.name} ${candidate.text}`.toLowerCase().includes(query)).slice(0, 40);
  }, [replacementQuery, replacements]);

  useEffect(() => bridge?.onSourceStoryPreviewProgress((progress) => {
    if (progress.jobId === previewJobId) setPreviewProgress(progress);
  }), [bridge, previewJobId]);

  useEffect(() => {
    let active = true;
    if (!bridge || !assembly?.preview?.path || !readiness?.previewCurrent) {
      setPreviewUrl('');
      return;
    }
    void bridge.registerSourceMedia(assembly.preview.path).then((result) => { if (active) setPreviewUrl(result.url); }).catch(() => { if (active) setPreviewUrl(''); });
    return () => { active = false; };
  }, [assembly?.preview?.path, bridge, readiness?.previewCurrent]);

  if (eligible.length < 2 && !assembly) return null;

  const locked = Boolean(assembly?.appliedBlockIds?.length);
  const structureLocked = locked || Boolean(previewJobId) || Boolean(readiness && (readiness.signaturesStale || readiness.directorStale || readiness.missingItems));
  const mutate = (action: (current: SourceStoryAssembly) => SourceStoryAssembly) => {
    if (!assembly) return;
    if (locked) return onMessage('全局粗剪已经写入时间轴；请先撤销本次装配，再修改结构。');
    setAssembly(action(assembly));
  };

  const create = () => {
    if (locked) return onMessage('请先撤销已经写入时间轴的全局装配。');
    if (assembly) {
      const next = refreshSourceStoryAssembly(assembly, sources, director);
      setAssembly(next);
      onMessage('已同步全局候选池，并尽量保留仍有效片段的顺序和职责；请重新确认。');
      return;
    }
    const next = createSourceStoryAssembly(sources, director);
    setAssembly(next);
    onMessage(`已汇总 ${next.items.length} 个保留片段；这里只建立全局候选池，尚未修改时间轴。`);
  };

  const refresh = () => {
    if (!assembly || locked) return;
    const next = refreshSourceStoryAssembly(assembly, sources, director);
    setAssembly(next);
    onMessage('已同步各原片的最新保留决定；原有全局顺序和职责尽量保留，请重新确认。');
  };

  const confirm = () => {
    if (!assembly) return;
    try {
      setAssembly(confirmSourceStoryAssembly(assembly, sources, director.updatedAt));
      onMessage('跨原片故事结构已确认；下一步生成整条结构预览，逐切点确认后才能写入时间轴。');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const generatePreview = async () => {
    if (!assembly || !readiness || !bridge || previewJobId || !assembly.confirmedAt || !readiness.complete) return;
    const revision = useEditorHistoryStore.getState().revision;
    const jobId = `story-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const request: SourceStoryPreviewRequest = {
      jobId,
      structureFingerprint: readiness.structureFingerprint,
      segments: readiness.resolved.map((item) => ({
        sourcePath: item.source.path,
        sourceName: item.source.name,
        start: item.candidate.start,
        end: item.candidate.end,
        narrativeRole: item.narrativeRole!,
      })),
    };
    setPreviewJobId(jobId);
    setPreviewProgress({ jobId, phase: 'extracting', percent: 0, segmentCount: request.segments.length });
    setBoundaryImages({});
    onMessage('正在逐段生成 720p 低码率结构预览；每个切口都有 30ms 音频淡入淡出…');
    try {
      const result = await bridge.generateSourceStoryPreview(request);
      if (useEditorHistoryStore.getState().revision !== revision) throw new Error('生成期间工程已编辑或撤销，请重新生成预览。');
      const current = useEditorStore.getState().storyAssembly;
      if (!current || result.structureFingerprint !== readiness.structureFingerprint) throw new Error('生成期间结构已变化，这份预览不再有效。');
      setAssembly({ ...current, preview: { path: result.path, duration: result.duration, generatedAt: new Date().toISOString(), structureFingerprint: result.structureFingerprint, boundaries: result.boundaries } });
      setPreviewUrl(result.url);
      onMessage(`结构预览已生成${result.cached ? '（缓存命中）' : ''}。请完整播放，并逐个确认 ${result.boundaries.length} 个切点。`);
    } catch (error) {
      onMessage(`结构预览失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPreviewJobId('');
    }
  };

  const cancelPreview = async () => {
    if (!bridge || !previewJobId) return;
    const result = await bridge.cancelSourceStoryPreview(previewJobId);
    if (result.canceled) onMessage('已取消结构预览生成。');
  };

  const inspectBoundary = async (index: number, outputTime: number) => {
    if (!bridge || !assembly?.preview || boundaryBusy >= 0) return;
    const revision = useEditorHistoryStore.getState().revision;
    setBoundaryBusy(index);
    try {
      const result = await bridge.generateSourceVisualCheckpoint(assembly.preview.path, Math.max(0, outputTime - 0.18), Math.min(assembly.preview.duration, outputTime + 0.18));
      if (useEditorHistoryStore.getState().revision !== revision) throw new Error('工程已编辑或撤销，请重新检查切点。');
      setBoundaryImages((current) => ({ ...current, [index]: result.image }));
      if (previewVideoRef.current) previewVideoRef.current.currentTime = Math.max(0, outputTime - 1.2);
    } catch (error) {
      onMessage(`切点检查失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBoundaryBusy(-1);
    }
  };

  const setBoundaryStatus = (index: number, status: 'approved' | 'adjust') => {
    if (!assembly?.preview) return;
    setAssembly({ ...assembly, preview: { ...assembly.preview, reviewedAt: undefined, boundaries: assembly.preview.boundaries.map((boundary, boundaryIndex) => boundaryIndex === index ? { ...boundary, status } : boundary) } });
  };

  const reviseBoundary = (itemIndex: number, edge: 'start' | 'end', delta: number) => {
    if (!assembly || locked) return;
    try {
      const revised = reviseSourceStoryBoundary(assembly, sources, director, itemIndex, edge, delta);
      const sourceId = assembly.items[itemIndex]?.sourceId;
      const nextSource = revised.sources.find((source) => source.id === sourceId);
      if (sourceId && nextSource) updateSourceMedia(sourceId, { roughCutPlan: nextSource.roughCutPlan });
      setAssembly(revised.assembly);
      setBoundaryImages({});
      onMessage(`已按逐词边界调整 50ms，旧视觉结论和结构预览已失效；请重新检查、确认并生成预览。`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const replaceItem = (index: number, value: string) => {
    if (!assembly || !value) return;
    try {
      const [sourceId, candidateId] = JSON.parse(value) as [string, string];
      setAssembly(replaceSourceStoryItem(assembly, index, sourceId, candidateId));
      setBoundaryImages({});
      setReplacementTarget(-1);
      setReplacementQuery('');
      onMessage('已替换全局候选；原片审片决定未改动，请重新确认结构并生成预览。');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const canReviseBoundary = (itemIndex: number) => {
    const item = readiness?.resolved[itemIndex];
    return Boolean(item && item.candidate.boundary === 'word' && item.source.transcript?.some((segment) => segment.words?.length));
  };

  const confirmPreview = () => {
    if (!assembly?.preview || assembly.preview.boundaries.some((boundary) => boundary.status !== 'approved')) return;
    setAssembly({ ...assembly, preview: { ...assembly.preview, reviewedAt: new Date().toISOString() } });
    onMessage('整条结构预览和全部切点已确认；满足其他视觉门禁后可以正式写入时间轴。');
  };

  const append = () => {
    if (!assembly || !readiness?.ready) return;
    let cursor = useUIStore.getState().currentTime;
    const blockIds: string[] = [];
    for (const item of readiness.resolved) {
      useUIStore.getState().setTime(cursor);
      blockIds.push(addSourceClip(item.source.id, item.candidate.start, item.candidate.end));
      cursor += item.candidate.end - item.candidate.start;
    }
    useUIStore.getState().setTime(cursor);
    setAssembly({ ...assembly, appliedAt: new Date().toISOString(), appliedBlockIds: blockIds });
    onMessage(`已按全局导演顺序装配 ${blockIds.length} 段、共 ${clock(readiness.duration)}；所有原片保持不变。`);
  };

  const undo = () => {
    if (!assembly?.appliedBlockIds?.length) return;
    assembly.appliedBlockIds.forEach(removeBlock);
    setAssembly({ ...assembly, appliedAt: undefined, appliedBlockIds: undefined });
    onMessage('已撤销全局故事装配；排序、职责和确认记录仍保留。');
  };

  return <div className="rounded-md border border-violet-300/25 bg-violet-300/[0.045] p-2">
    <div className="flex items-start justify-between gap-2">
      <div><h4 className="text-[10px] font-semibold text-violet-100">跨原片故事装配</h4><p className="mt-0.5 text-[8.5px] leading-relaxed text-ink-faint">把不同原片的已保留段放进同一条故事线。重复内容只提醒，由你决定取舍。</p></div>
      <button type="button" onClick={create} disabled={locked || eligible.length < 2} className="shrink-0 rounded border border-violet-300/30 px-2 py-1 text-[8.5px] text-violet-100 disabled:opacity-40">{assembly ? '同步候选池' : '建立全局候选池'}</button>
    </div>
    {!assembly && <p className="mt-1.5 text-[8px] text-ink-faint">已有 {eligible.length} 条原片产生保留候选。至少两条后即可统一编排。</p>}
    {assembly && readiness && <>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[8px] text-ink-faint">
        <span className="rounded border border-stroke px-1.5 py-0.5">{readiness.sourceCount} 条原片</span>
        <span className="rounded border border-stroke px-1.5 py-0.5">{readiness.resolved.length} 个片段</span>
        <span className="rounded border border-stroke px-1.5 py-0.5">预计 {clock(readiness.duration)}</span>
        <span className="rounded border border-stroke px-1.5 py-0.5">重复提醒 {readiness.duplicates.length}</span>
      </div>
      {(readiness.signaturesStale || readiness.directorStale || readiness.missingItems > 0) && <div className="mt-1.5 flex items-center gap-1.5 rounded border border-amber-300/25 bg-amber-300/[0.05] p-1.5"><p className="min-w-0 flex-1 text-[8px] text-amber-100">原片决定或导演 Brief 已变化，全局结构需要同步。</p><button type="button" onClick={refresh} disabled={locked} className="rounded bg-amber-500 px-1.5 py-1 text-[8px] text-slate-950 disabled:opacity-40">同步最新决定</button></div>}
      <div className="mt-1.5 flex justify-end"><button type="button" disabled={structureLocked} onClick={() => mutate((current) => applySourceStoryTemplate(current, director.contentType))} className="rounded border border-violet-300/25 px-1.5 py-1 text-[8px] text-violet-100 disabled:opacity-40">按当前内容类型预填职责</button></div>
      {readiness.duplicates.length > 0 && <div className="mt-1.5 rounded border border-amber-300/20 bg-amber-300/[0.035] p-1.5"><p className="text-[8px] font-medium text-amber-100">可能重复，只提示、不自动删除：</p>{readiness.duplicates.slice(0, 5).map((warning, index) => <p key={`${warning.left.candidate.id}-${warning.right.candidate.id}`} className="mt-0.5 truncate text-[7.5px] text-ink-faint">{index + 1}. {warning.left.source.name}「{warning.left.candidate.text}」≈ {warning.right.source.name}「{warning.right.candidate.text}」</p>)}</div>}
      <div className="mt-1.5 max-h-72 space-y-1 overflow-y-auto">
        {readiness.resolved.map((item, index) => <div key={`${item.source.id}:${item.candidate.id}`} className="flex items-center gap-1 rounded border border-stroke bg-panel/60 p-1">
          <span className="w-4 shrink-0 text-center font-mono text-[8px] text-violet-200">{index + 1}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-[8.5px] text-ink-dim">{item.candidate.text}</p><p className="truncate text-[7px] text-ink-faint">{item.source.name} · {clock(item.candidate.start)}–{clock(item.candidate.end)}</p></div>
          <select disabled={structureLocked} value={item.narrativeRole ?? ''} onChange={(event) => mutate((current) => assignSourceStoryRole(current, index, event.target.value as NarrativeRole))} className="max-w-28 rounded border border-stroke bg-panel px-1 py-0.5 text-[7.5px] text-ink disabled:opacity-40"><option value="" disabled>选择职责</option>{roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select>
          {replacements.length > 0 && <button type="button" disabled={structureLocked} onClick={() => { setReplacementTarget(index); setReplacementQuery(''); }} className="rounded border border-stroke px-1 py-0.5 text-[7.5px] text-ink-faint disabled:opacity-40">替换</button>}
          <div className="flex shrink-0 flex-col gap-0.5"><button type="button" disabled={structureLocked || index === 0} onClick={() => mutate((current) => moveSourceStoryItem(current, index, -1))} className="rounded border border-stroke px-1 text-[7px] text-ink-faint disabled:opacity-25">↑</button><button type="button" disabled={structureLocked || index === readiness.resolved.length - 1} onClick={() => mutate((current) => moveSourceStoryItem(current, index, 1))} className="rounded border border-stroke px-1 text-[7px] text-ink-faint disabled:opacity-25">↓</button></div>
          <button type="button" title="只从全局结构移除，不修改原片候选" disabled={structureLocked} onClick={() => mutate((current) => removeSourceStoryItem(current, index))} className="shrink-0 rounded border border-red-300/20 px-1 text-[8px] text-red-200 disabled:opacity-40">×</button>
        </div>)}
      </div>
      {replacementTarget >= 0 && <div className="mt-1.5 rounded border border-violet-300/20 bg-panel/80 p-1.5"><div className="flex gap-1"><input autoFocus value={replacementQuery} onChange={(event) => setReplacementQuery(event.target.value)} placeholder={`搜索替换第 ${replacementTarget + 1} 段的候选`} className="min-w-0 flex-1 rounded border border-stroke bg-panel px-1.5 py-1 text-[8px] text-ink outline-none" /><button type="button" onClick={() => setReplacementTarget(-1)} className="rounded border border-stroke px-1.5 text-[8px] text-ink-faint">关闭</button></div><div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">{visibleReplacements.map(({ source, candidate }) => <button type="button" key={`${source.id}:${candidate.id}`} onClick={() => replaceItem(replacementTarget, JSON.stringify([source.id, candidate.id]))} className="block w-full truncate rounded px-1.5 py-1 text-left text-[7.5px] text-ink-dim hover:bg-violet-300/10"><span className="text-violet-200">{source.name}</span> · {candidate.text}</button>)}{!visibleReplacements.length && <p className="py-1 text-center text-[7.5px] text-ink-faint">没有匹配候选</p>}</div></div>}
      <SourceStoryVersionPanel onMessage={onMessage} />
      <div className="mt-1.5 rounded border border-cyan-300/20 bg-cyan-300/[0.035] p-1.5">
        <div className="flex items-center gap-1.5"><div className="min-w-0 flex-1"><p className="text-[8.5px] font-medium text-cyan-100">执行前结构预览</p><p className="text-[7.5px] text-ink-faint">720p 低码率 · 带片段编号、来源和职责 · 不写入正式时间轴</p></div>{previewJobId ? <button type="button" onClick={() => void cancelPreview()} className="rounded border border-red-300/25 px-1.5 py-1 text-[8px] text-red-200">取消</button> : <button type="button" onClick={() => void generatePreview()} disabled={!bridge || !assembly.confirmedAt || !readiness.complete || locked} className="rounded bg-cyan-600 px-1.5 py-1 text-[8px] text-white disabled:opacity-40">{readiness.previewCurrent ? '重新生成预览' : '生成结构预览'}</button>}</div>
        {previewJobId && previewProgress && <div className="mt-1.5"><div className="mb-0.5 flex justify-between text-[7.5px] text-cyan-100"><span>{previewProgress.phase === 'extracting' ? `处理片段 ${(previewProgress.segmentIndex ?? 0) + 1}/${previewProgress.segmentCount}` : previewProgress.phase === 'joining' ? '无损拼接预览' : '校验时长'}</span><span>{previewProgress.percent}%</span></div><div className="h-1.5 overflow-hidden rounded bg-panel-3"><div className="h-full bg-cyan-400" style={{ width: `${previewProgress.percent}%` }} /></div></div>}
        {previewUrl && assembly.preview && readiness.previewCurrent && <>
          <video ref={previewVideoRef} src={previewUrl} controls preload="metadata" className="mt-1.5 aspect-video w-full rounded bg-black object-contain" />
          <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto">{assembly.preview.boundaries.map((boundary, index) => <div key={`${boundary.outputTime}-${index}`} className="rounded border border-stroke bg-panel/60 p-1">
            <div className="flex items-center gap-1"><button type="button" onClick={() => { if (previewVideoRef.current) previewVideoRef.current.currentTime = Math.max(0, boundary.outputTime - 1.2); }} className="font-mono text-[8px] text-cyan-200">切点 {index + 1} · {clock(boundary.outputTime)}</button><span className="min-w-0 flex-1 truncate text-[7.5px] text-ink-faint">#{boundary.beforeIndex + 1} → #{boundary.afterIndex + 1}</span><button type="button" disabled={boundaryBusy >= 0} onClick={() => void inspectBoundary(index, boundary.outputTime)} className="rounded border border-cyan-300/20 px-1 py-0.5 text-[7.5px] text-cyan-100 disabled:opacity-40">{boundaryBusy === index ? '提取中…' : '九帧检查'}</button><button type="button" onClick={() => setBoundaryStatus(index, 'approved')} className={`rounded px-1 py-0.5 text-[7.5px] ${boundary.status === 'approved' ? 'bg-emerald-600 text-white' : 'border border-stroke text-ink-faint'}`}>通过</button><button type="button" onClick={() => setBoundaryStatus(index, 'adjust')} className={`rounded px-1 py-0.5 text-[7.5px] ${boundary.status === 'adjust' ? 'bg-red-600 text-white' : 'border border-stroke text-ink-faint'}`}>需调整</button></div>
            {boundaryImages[index] && <img src={boundaryImages[index]} alt={`切点 ${index + 1} 前后九帧检查`} className="mt-1 w-full rounded" />}
            {boundary.status === 'adjust' && <div className="mt-1 grid grid-cols-2 gap-1 text-[7px]">
              <div className="grid grid-cols-2 gap-1"><button type="button" disabled={!canReviseBoundary(boundary.beforeIndex)} onClick={() => reviseBoundary(boundary.beforeIndex, 'end', -0.05)} className="rounded border border-stroke px-1 py-0.5 text-ink-faint disabled:opacity-30">前段早收50ms</button><button type="button" disabled={!canReviseBoundary(boundary.beforeIndex)} onClick={() => reviseBoundary(boundary.beforeIndex, 'end', 0.05)} className="rounded border border-stroke px-1 py-0.5 text-ink-faint disabled:opacity-30">前段晚收50ms</button></div>
              <div className="grid grid-cols-2 gap-1"><button type="button" disabled={!canReviseBoundary(boundary.afterIndex)} onClick={() => reviseBoundary(boundary.afterIndex, 'start', 0.05)} className="rounded border border-stroke px-1 py-0.5 text-ink-faint disabled:opacity-30">后段早进50ms</button><button type="button" disabled={!canReviseBoundary(boundary.afterIndex)} onClick={() => reviseBoundary(boundary.afterIndex, 'start', -0.05)} className="rounded border border-stroke px-1 py-0.5 text-ink-faint disabled:opacity-30">后段晚进50ms</button></div>
              <button type="button" onClick={() => mutate((current) => moveSourceStoryItem(current, boundary.afterIndex, -1))} className="col-span-2 rounded border border-violet-300/25 px-1 py-0.5 text-violet-100">交换切点前后两个片段</button>
              {(!canReviseBoundary(boundary.beforeIndex) || !canReviseBoundary(boundary.afterIndex)) && <p className="col-span-2 text-amber-100/80">SRT、人工动作或缺少逐词时间码时，请回源播放器修改对应边界，不能伪精确调整。</p>}
            </div>}
          </div>)}</div>
          <div className="mt-1.5 flex items-center gap-1.5"><p className="min-w-0 flex-1 text-[7.5px] text-ink-faint">已通过 {assembly.preview.boundaries.filter((boundary) => boundary.status === 'approved').length}/{assembly.preview.boundaries.length} 个切点</p><button type="button" onClick={confirmPreview} disabled={assembly.preview.boundaries.some((boundary) => boundary.status !== 'approved')} className="rounded bg-emerald-600 px-1.5 py-1 text-[8px] text-white disabled:opacity-40">{readiness.previewReviewed ? '预览已确认' : '确认整条预览通过'}</button></div>
        </>}
      </div>
      <div className="mt-1.5 flex gap-1">
        <button type="button" onClick={confirm} disabled={locked || !readiness.complete} className="rounded border border-violet-300/30 px-2 py-1.5 text-[8.5px] text-violet-100 disabled:opacity-40">{assembly.confirmedAt && !readiness.signaturesStale && !readiness.directorStale ? '结构已确认' : readiness.missingRoles ? `还缺 ${readiness.missingRoles} 段职责` : '确认全局结构'}</button>
        <button type="button" onClick={append} disabled={!readiness.ready} className="min-w-0 flex-1 rounded bg-violet-500 px-2 py-1.5 text-[9px] font-medium text-white disabled:opacity-40">{locked ? '已写入时间轴' : !assembly.confirmedAt ? '先确认全局结构' : readiness.signaturesStale || readiness.directorStale ? '先同步最新决定' : !readiness.previewReviewed ? '先生成并确认结构预览' : readiness.unchecked.length ? `还需检查 ${readiness.unchecked.length} 段画面` : `按全局顺序装配 ${readiness.resolved.length} 段`}</button>
        {locked && <button type="button" onClick={undo} className="rounded border border-red-300/25 px-2 py-1.5 text-[8.5px] text-red-200">撤销装配</button>}
      </div>
    </>}
  </div>;
}
