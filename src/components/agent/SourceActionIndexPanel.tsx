import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExternalMediaSource, SourceActionSemantics, SourceEventMarkerKind } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { useEditorHistoryStore } from '@/store/editorHistory';
import { actionShotLabels, actionSourceSignature, createActionEntry, searchActionIndex, validActionRange } from '@/lib/sourceActionIndex';
import type { SourceVisualCheckpointResult } from '@/lib/sourceVisualCheckpoint';

interface Bridge {
  registerSourceMedia: (path: string) => Promise<{ url: string }>;
  generateSourceVisualCheckpoint: (path: string, start: number, end: number) => Promise<SourceVisualCheckpointResult>;
}
const empty = { subject: '', action: '', object: '', result: '', tags: '', shot: 'unspecified' as SourceActionSemantics['shot'], kind: 'action' as SourceEventMarkerKind };
const kindLabels = { action: '动作', highlight: '重点保留', exclude: '明确不要' };
const fields = { subject: '主体', action: '动作', object: '对象', result: '结果', tags: '标签' };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}.${Math.round(seconds % 1 * 10)}`;
const bytesLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export default function SourceActionIndexPanel({ source, start, end, onMessage }: {
  source: ExternalMediaSource; start: number; end: number; onMessage: (text: string) => void;
}) {
  const sources = useEditorStore((s) => s.sourceMedia);
  const epoch = useEditorHistoryStore((s) => s.epoch);
  const [draft, setDraft] = useState(empty);
  const [confirmed, setConfirmed] = useState(false);
  const [query, setQuery] = useState('');
  const [shot, setShot] = useState('');
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ key: string; path: string; start: number; end: number; url?: string; image?: string; times?: number[] }>();
  const request = useRef(0);
  const signature = actionSourceSignature(source);
  useEffect(() => { setConfirmed(false); setPreview(undefined); request.current++; setBusy(false); }, [signature, start, end, epoch, sources]);
  useEffect(() => () => { request.current++; }, []);
  const rows = useMemo(() => searchActionIndex(sources, query, shot, kind), [sources, query, shot, kind]);
  const locked = Boolean(source.roughCutPlan?.appliedBlockIds?.length);
  const valid = validActionRange(source, start, end);
  const field = 'min-w-0 rounded border border-stroke bg-panel px-2 py-1 text-ink';
  const button = 'rounded border border-stroke px-2 py-1 disabled:opacity-40';
  const inspect = async (item: ExternalMediaSource, from: number, to: number, visual: boolean) => {
    const bridge = (window as Window & { hyperframesElectron?: Bridge }).hyperframesElectron;
    if (!bridge) return onMessage('按需播放与九帧检查需要桌面版；可观看已有原片后填写人工观察。');
    if (!validActionRange(item, from, to)) return onMessage('原片离线或区间无效，请重新定位来源。');
    if (visual && to - from > 120) return onMessage('请把检查范围缩小到 120 秒以内，逐个动作审片。');
    const serial = ++request.current;
    const revision = useEditorHistoryStore.getState().revision;
    const key = JSON.stringify([actionSourceSignature(item), from, to]);
    setBusy(true);
    try {
      const result = visual ? await bridge.generateSourceVisualCheckpoint(item.path, from, to) : await bridge.registerSourceMedia(item.path);
      if (serial !== request.current) return;
      if (revision !== useEditorHistoryStore.getState().revision) throw new Error('工程已变化，请重新请求审片。');
      setPreview((previous) => ({ ...(previous?.key === key ? previous : {}), key, path: item.path, start: from, end: to,
        ...('url' in result ? { url: result.url } : { image: result.image, times: result.times }) }));
    } catch (error) { if (serial === request.current) onMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (serial === request.current) setBusy(false); }
  };
  const save = () => {
    try {
      const state = useEditorStore.getState();
      const current = state.sourceMedia.find((item) => item.id === source.id);
      if (!current || actionSourceSignature(current) !== signature) throw new Error('来源已变化，请重新审片。');
      const entry = createActionEntry(current, { start, end }, draft, confirmed);
      state.updateSourceMedia(current.id, { eventMarkers: [...(current.eventMarkers ?? []), entry].sort((a, b) => a.start - b.start), roughCutPlan: undefined });
      setDraft(empty); setConfirmed(false);
      onMessage('已保存人工视觉语义索引。请重新生成粗剪候选，并完成切点检查、结构预演和选版。');
    } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <section aria-label="视觉动作索引" className="space-y-2 rounded border border-cyan-300/20 p-2 text-[10px] text-ink-dim">
    <h4 className="font-semibold text-cyan-100">视觉动作索引 · 人工观察</h4>
    <p>圈定动作后，记录主体、动作和结果。跨原片检索已确认记录；不自动识别动作，也不以无转写判定无台词。</p>
    <p className="break-all">当前原片：{source.path} · {start.toFixed(3)}–{end.toFixed(3)} 秒</p>
    <div className="flex gap-2"><button type="button" className={button} disabled={busy || !valid} onClick={() => void inspect(source, start, end, false)}>播放圈定动作</button><button type="button" className={button} disabled={busy || !valid || end - start > 120} onClick={() => void inspect(source, start, end, true)}>按需九帧检查</button></div>
    <p>九帧仅辅助检查（每次最多 120 秒），确认动作仍需观看区间。索引不替代粗剪视觉门禁。</p>
    <fieldset disabled={locked} className="space-y-2 disabled:opacity-50">
      <div className="grid grid-cols-2 gap-1">
        {(Object.keys(fields) as (keyof typeof fields)[]).map((key) => <input key={key} className={field} aria-label={`动作索引${fields[key]}`} placeholder={`${fields[key]}${key === 'action' ? '（必填）' : key === 'tags' ? '（逗号分隔）' : ''}`} value={draft[key]} onChange={(e) => { setDraft({ ...draft, [key]: e.target.value }); setConfirmed(false); }} />)}
        <select className={field} aria-label="动作索引景别" value={draft.shot} onChange={(e) => { setDraft({ ...draft, shot: e.target.value as SourceActionSemantics['shot'] }); setConfirmed(false); }}>{Object.entries(actionShotLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select className={field} aria-label="动作索引决定" value={draft.kind} onChange={(e) => { setDraft({ ...draft, kind: e.target.value as SourceEventMarkerKind }); setConfirmed(false); }}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
      <label className="block"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> 我已观看这个区间，确认描述、来源与入出点</label>
      <button type="button" className={button} disabled={!valid || !confirmed || !draft.action.trim()} onClick={save}>确认并加入动作索引</button>
    </fieldset>
    {locked && <p>已追加粗剪，请先撤销追加再修改索引。</p>}
    <div className="grid grid-cols-[2fr_1fr_1fr] gap-1">
      <input className={field} aria-label="搜索视觉动作" placeholder="搜索动作、主体、标签…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select className={field} aria-label="筛选景别" value={shot} onChange={(e) => setShot(e.target.value)}><option value="">全部景别</option>{Object.entries(actionShotLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select className={field} aria-label="筛选动作决定" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">全部决定</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    <p>{rows.length} 条匹配{rows.length > 50 ? '，显示前 50 条，请缩小搜索范围' : ''}。旧动作标记也可按原标签搜索。</p>
    <div className="max-h-64 space-y-2 overflow-y-auto">{rows.slice(0, 50).map(({ source: item, marker, current }) => <article key={`${item.id}:${marker.id}`} className="rounded border border-stroke p-2">
      <p>{marker.label} · {kindLabels[marker.kind]}</p><p className="break-all">{item.name} · {item.path} · {marker.start.toFixed(3)}–{marker.end.toFixed(3)} 秒</p>
      <p>{marker.semantics ? `${actionShotLabels[marker.semantics.shot]} · ${marker.semantics.tags.join(' / ')} · 人工确认 ${marker.semantics.reviewedAt}` : '旧版人工标记（未补充结构化语义）'}</p>
      {marker.semantics?.visualEvidence && <div className="mt-1 rounded border border-violet-300/20 bg-violet-300/[0.03] p-1.5 text-[9px]"><p>模型辅助回执：{marker.semantics.visualEvidence.mode === 'cross-frame' ? '跨帧' : '单帧'} · {marker.semantics.visualEvidence.analysisPass === 'refinement' ? '补帧复核' : '初次分析'} · {marker.semantics.visualEvidence.provider} / {marker.semantics.visualEvidence.model} · {marker.semantics.visualEvidence.frames.length} 张证据图{marker.semantics.visualEvidence.transcriptIncluded === undefined ? '' : marker.semantics.visualEvidence.transcriptIncluded ? ' · 包含时间窗口播' : ' · 仅截图、未含口播'}</p>{marker.semantics.visualEvidence.requestPayload && <><p>请求负载：面板会话第 {marker.semantics.visualEvidence.requestPayload.sessionRequestNumber} 次 · {marker.semantics.visualEvidence.requestPayload.imageCount} 张图片 / {bytesLabel(marker.semantics.visualEvidence.requestPayload.imageBytes)} · 口播 {marker.semantics.visualEvidence.requestPayload.transcriptCharacters} 字 · 跨度 {marker.semantics.visualEvidence.requestPayload.spanSeconds.toFixed(1)} 秒</p><p>Token 用量：{marker.semantics.visualEvidence.requestPayload.tokenUsage ? `服务报告输入 ${marker.semantics.visualEvidence.requestPayload.tokenUsage.inputTokens} / 输出 ${marker.semantics.visualEvidence.requestPayload.tokenUsage.outputTokens} / 合计 ${marker.semantics.visualEvidence.requestPayload.tokenUsage.totalTokens}` : '模型服务未返回'}</p>{marker.semantics.visualEvidence.requestPayload.duplicateFrameReview && <p className="text-amber-200">完全重复截图已人工确认 · {marker.semantics.visualEvidence.requestPayload.duplicateFrameReview.confirmedAt} · {marker.semantics.visualEvidence.requestPayload.duplicateFrameReview.groups.length} 组</p>}<p className="break-all text-ink-faint">请求批次：{marker.semantics.visualEvidence.requestPayload.requestId} · {marker.semantics.visualEvidence.requestPayload.requestedAt}</p><details className="text-ink-faint"><summary>完整请求帧指纹（{marker.semantics.visualEvidence.requestPayload.frames.length} 张）</summary>{marker.semantics.visualEvidence.requestPayload.frames.map((frame) => <p key={`${frame.id}|${frame.time}`} className="break-all">{clock(frame.time)} · {frame.id} · {frame.sha256 ?? '旧回执无指纹'}</p>)}</details></>}{marker.semantics.visualEvidence.refinementComparison && <p className={marker.semantics.visualEvidence.refinementComparison.status === 'changed' ? 'text-amber-200' : 'text-emerald-200'}>补帧前后：{marker.semantics.visualEvidence.refinementComparison.status === 'changed' ? `存在分歧（${marker.semantics.visualEvidence.refinementComparison.changedFields.join(' / ')}）${marker.semantics.visualEvidence.refinementReview ? ` · 人工已核对 ${marker.semantics.visualEvidence.refinementReview.reviewedAt}` : ''}` : '关键结论一致'}</p>}{marker.semantics.visualEvidence.visibleEvidence && <p>模型可见证据：{marker.semantics.visualEvidence.visibleEvidence}</p>}{marker.semantics.visualEvidence.changeWindows?.map((window) => <p key={`${window.beforeFrameId}|${window.afterFrameId}`}>变化窗 {clock(window.start)}–{clock(window.end)}：{window.assessment === 'visible-change' ? '可见变化' : window.assessment === 'possible-change' ? '可能变化' : '未见明确变化'} · {(window.confidence * 100).toFixed(0)}%{window.evidence ? ` · ${window.evidence}` : ''}</p>)}{marker.semantics.visualEvidence.uncertainty && <p className="text-amber-200">模型不确定性：{marker.semantics.visualEvidence.uncertainty}</p>}<p className="text-ink-faint">模型原候选：{[marker.semantics.visualEvidence.proposal.subject, marker.semantics.visualEvidence.proposal.action, marker.semantics.visualEvidence.proposal.object, marker.semantics.visualEvidence.proposal.result].filter(Boolean).join(' · ') || '空'} · 人工确认后的字段以上方索引为准</p></div>}
      {marker.semantics?.visualEvidence?.requestPayload?.similarFrameReview && <p className="text-orange-200">高度相似截图已人工确认 · {marker.semantics.visualEvidence.requestPayload.similarFrameReview.confirmedAt} · {marker.semantics.visualEvidence.requestPayload.similarFrameReview.pairs.length} 组 · 感知距离阈值 {marker.semantics.visualEvidence.requestPayload.similarFrameReview.maxHammingDistance}/64</p>}
      {!current && <p className="text-amber-200">来源或范围已变化/离线，需重新审片，不可沿用此确认。</p>}
      <div className="flex gap-2"><button type="button" className={button} disabled={busy || !current} onClick={() => void inspect(item, marker.start, marker.end, false)}>回看原片区间</button><button type="button" className={button} disabled={busy || !current || marker.end - marker.start > 120} onClick={() => void inspect(item, marker.start, marker.end, true)}>检查这条动作</button></div>
    </article>)}</div>
    {preview && <div className="space-y-1 border border-stroke p-2"><p className="break-all">审片：{preview.path} · {preview.start.toFixed(3)}–{preview.end.toFixed(3)} 秒</p>
      {preview.url && <video key={preview.key} src={preview.url} controls className="w-full" onLoadedMetadata={(e) => { e.currentTarget.currentTime = preview.start; }} onPlay={(e) => { if (e.currentTarget.currentTime < preview.start || e.currentTarget.currentTime >= preview.end) e.currentTarget.currentTime = preview.start; }} onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= preview.end) e.currentTarget.pause(); }} />}
      {preview.image && <><img src={preview.image} alt="动作区间入点、中部、出点九帧检查" className="w-full" /><p>原片时间（秒）：{preview.times?.map((time) => time.toFixed(3)).join(' / ')}</p></>}
    </div>}
  </section>;
}
