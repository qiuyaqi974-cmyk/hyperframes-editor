import { useEffect, useState } from 'react';
import { useEditorHistoryStore } from '@/store/editorHistory';
import { useEditorStore } from '@/store/editorStore';
import { finalizeExternalClips } from '@/lib/externalClipInbox';
import OtioTimelineSummary from './OtioTimelineSummary';
import type { SourceVisualCheckpointResult } from '@/lib/sourceVisualCheckpoint';
import type { ExternalClipReview, NarrativeRole } from '@/types';

interface Bridge {
  registerSourceMedia: (path: string) => Promise<{ url: string }>;
  generateSourceVisualCheckpoint: (path: string, start: number, end: number) => Promise<SourceVisualCheckpointResult>;
}
const roles: Record<NarrativeRole, string> = { hook: '钩子', context: '背景', argument: '核心', proof: '证明', turn: '转折', cta: '结尾', custom: '自定义' };

export default function ExternalClipInboxPanel({ onMessage }: { onMessage: (message: string) => void }) {
  const inboxes = useEditorStore((s) => s.externalClipInboxes);
  const [images, setImages] = useState<Record<string, string>>({});
  const [playback, setPlayback] = useState<{ id: string; url: string; start: number; end: number }>();
  const [busy, setBusy] = useState(false);
  const historyEpoch = useEditorHistoryStore((s) => s.epoch);
  useEffect(() => { setImages({}); setPlayback(undefined); }, [historyEpoch]);
  const bridge = (window as Window & { hyperframesElectron?: Bridge }).hyperframesElectron;
  const patch = (inboxId: string, clipId: string, change: Partial<ExternalClipReview>) => {
    const state = useEditorStore.getState();
    state.setExternalClipInboxes(state.externalClipInboxes.map((box) => box.id !== inboxId || box.savedVersionId ? box : { ...box, clips: box.clips.map((clip) => clip.id === clipId ? { ...clip, ...change } : clip) }));
  };
  const inspect = async (inboxId: string, clip: ExternalClipReview, visual: boolean) => {
    if (!bridge) return onMessage('播放原片和生成九帧检查图需要桌面版。');
    const revision = useEditorHistoryStore.getState().revision;
    setBusy(true);
    try {
      if (visual) {
        const result = await bridge.generateSourceVisualCheckpoint(clip.sourcePath, clip.start, clip.end);
        if (useEditorHistoryStore.getState().revision !== revision) throw new Error('工程已编辑或撤销，请重新生成检查图。');
        setImages((current) => ({ ...current, [clip.id]: result.image }));
        patch(inboxId, clip.id, { visualStatus: 'generated', decision: 'pending' });
      } else {
        const result = await bridge.registerSourceMedia(clip.sourcePath);
        setPlayback({ id: clip.id, url: result.url, start: clip.start, end: clip.end });
      }
    } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const save = (id: string) => {
    try {
      const state = useEditorStore.getState();
      const inbox = state.externalClipInboxes.find((box) => box.id === id)!;
      const base = state.storyAssemblyVersions.find((v) => v.id === inbox.parentVersionId);
      if (!base) throw new Error('父胜出方案已失效。');
      const result = finalizeExternalClips(inbox, base, state.sourceMedia, state.storyAssemblyVersions);
      useEditorStore.setState({ storyAssemblyVersions: [...state.storyAssemblyVersions, result.version], externalClipInboxes: state.externalClipInboxes.map((box) => box.id === id ? { ...box, savedVersionId: result.version.id } : box) });
      onMessage(`已保存 ${result.version.label}。${result.version.externalTimeline ? 'OTIO 原始时间线已保留，可从方案列表重新导出；本机恢复范围见时间线说明。' : '请主动恢复，再完成视觉检查、结构预演和选版。'}`);
    } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  };
  if (!inboxes.length) return null;
  return <section className="mt-2 space-y-2 rounded border border-amber-300/30 p-2 text-[9px] text-ink">
    <h3>外部时间线与新增片段待审收件箱</h3>
    {inboxes.map((box) => {
      let summary = '';
      let ready = false;
      if (!box.savedVersionId) {
        try {
          const state = useEditorStore.getState();
          const base = state.storyAssemblyVersions.find((v) => v.id === box.parentVersionId);
          if (!base) throw new Error('父方案已失效');
          const { diff } = finalizeExternalClips(box, base, state.sourceMedia, state.storyAssemblyVersions);
          summary = `新增 ${diff.added} · 删除 ${diff.removed} · 换位 ${diff.moved} · 切点变化 ${diff.boundaryChanged} · 职责变化 ${diff.roleChanged}`;
          ready = true;
        } catch (error) { summary = error instanceof Error ? error.message : String(error); }
      }
      return <article key={box.id} className="space-y-2 rounded border border-stroke p-2">
        <p>{box.fileName} · {new Date(box.importedAt).toLocaleString()} · 父方案 {box.parentVersionId}{box.savedVersionId ? ' · 已保存' : ''}</p>
        {box.externalTimeline && <OtioTimelineSummary timeline={box.externalTimeline} />}
        {box.clips.map((clip) => <fieldset key={clip.id} disabled={Boolean(box.savedVersionId) || busy} className="space-y-1 border border-stroke p-2">
          <p className="break-all">{clip.label || '外部新增片段'} · {clip.sourcePath}</p>
          <p>{clip.start.toFixed(3)}s → {clip.end.toFixed(3)}s · {clip.boundaryStatus === 'word' ? '逐词边界校验' : '人工边界（无逐词时间码）'} · {clip.decision === 'pending' ? '待审' : clip.decision === 'approve' ? '允许纳入' : '拒绝'}</p>
          <p>{clip.text}</p>
          <button type="button" onClick={() => void inspect(box.id, clip, false)}>播放此范围</button>{' · '}
          <button type="button" onClick={() => void inspect(box.id, clip, true)}>生成九帧检查图</button>
          {playback?.id === clip.id && <video key={playback.url + clip.id} src={playback.url} controls className="w-full" onLoadedMetadata={(e) => { e.currentTarget.currentTime = playback.start; }} onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= playback.end) e.currentTarget.pause(); }} onPlay={(e) => { if (e.currentTarget.currentTime < playback.start || e.currentTarget.currentTime >= playback.end) e.currentTarget.currentTime = playback.start; }} />}
          {images[clip.id] && <img src={images[clip.id]} alt="入点、中部和出点的九帧检查图" className="w-full" />}
          <label className="block"><input type="checkbox" checked={clip.mappingStatus === 'confirmed'} onChange={(e) => patch(box.id, clip.id, { mappingStatus: e.target.checked ? 'confirmed' : 'pending', decision: 'pending' })} /> 已确认来源原片</label>
          <label className="block"><input type="checkbox" checked={clip.boundaryConfirmed} onChange={(e) => patch(box.id, clip.id, { boundaryConfirmed: e.target.checked, decision: 'pending' })} /> 已检查精确入出点{clip.boundaryStatus === 'manual' ? '（人工确认）' : ''}</label>
          <label className="block"><input type="checkbox" disabled={clip.visualStatus === 'pending'} checked={clip.visualStatus === 'approved'} onChange={(e) => patch(box.id, clip.id, { visualStatus: e.target.checked ? 'approved' : 'generated', decision: 'pending' })} /> 九帧视觉检查通过</label>
          <select aria-label="叙事职责" className="bg-panel" value={clip.narrativeRole ?? ''} onChange={(e) => patch(box.id, clip.id, { narrativeRole: e.target.value as NarrativeRole || undefined, decision: 'pending' })}><option value="">选择叙事职责</option>{Object.entries(roles).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select>
          <input className="w-full bg-panel" aria-label="决定理由" placeholder="决定理由（拒绝必填）" value={clip.reason} onChange={(e) => patch(box.id, clip.id, { reason: e.target.value })} />
          <div className="flex gap-3"><button type="button" disabled={clip.mappingStatus !== 'confirmed' || !clip.boundaryConfirmed || clip.visualStatus !== 'approved' || !clip.narrativeRole} onClick={() => patch(box.id, clip.id, { decision: 'approve' })}>允许纳入</button><button type="button" disabled={!clip.reason.trim()} onClick={() => patch(box.id, clip.id, { decision: 'reject' })}>拒绝</button></div>
        </fieldset>)}
        {!box.savedVersionId && <><p>{summary}</p><button type="button" disabled={!ready || busy} onClick={() => save(box.id)} className="rounded bg-amber-700 p-1 disabled:opacity-40">确认差异并保存派生方案</button></>}
      </article>;
    })}
  </section>;
}
