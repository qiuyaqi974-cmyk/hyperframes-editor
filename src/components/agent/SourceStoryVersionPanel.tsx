import { useEffect, useMemo, useRef, useState } from 'react';
import { sourceStoryAssemblyReadiness } from '@/lib/sourceStoryAssembly';
import { compareSourceStoryVersions, createSourceStoryVersion, restoreSourceStoryVersion } from '@/lib/sourceStoryVersions';
import { createWinningStoryHandoff, type WinningStoryHandoffPayload } from '@/lib/sourceStoryHandoff';
import { importRefinedStoryEdl } from '@/lib/sourceStoryRoundtrip';
import { inspectExternalClips } from '@/lib/externalClipInbox';
import ExternalClipInboxPanel from './ExternalClipInboxPanel';
import OtioTimelineSummary from './OtioTimelineSummary';
import { createOtioTimeline } from '@/lib/otioTimeline';
import { createFcpxmlTimeline, fcpxmlToEdl } from '@/lib/fcpxmlTimeline';
import { useEditorHistoryStore } from '@/store/editorHistory';
import { useEditorStore } from '@/store/editorStore';
import type { NarrativeRole, SourceStoryAssemblyVersion } from '@/types';

interface Props { onMessage: (message: string) => void }

interface PreviewBridge {
  registerSourceMedia: (path: string) => Promise<{ url: string }>;
  exportWinningStoryHandoff?: (payload: WinningStoryHandoffPayload) => Promise<{ canceled: boolean; outputPath?: string; fileCount?: number; sourceCount?: number }>;
  revealPath?: (path: string) => Promise<string>;
}

const roleNames: Record<NarrativeRole, string> = { hook: '钩子', context: '背景', argument: '核心', proof: '证明', turn: '转折', cta: '结尾', custom: '自定义' };

function roleOffsets(version: SourceStoryAssemblyVersion) {
  let cursor = 0;
  const offsets = new Map<NarrativeRole, number>();
  for (const segment of version.segments) {
    if (segment.narrativeRole && !offsets.has(segment.narrativeRole)) offsets.set(segment.narrativeRole, cursor);
    cursor += segment.end - segment.start;
  }
  return offsets;
}

function previewApproved(version?: SourceStoryAssemblyVersion) {
  const preview = version?.assembly.preview;
  return Boolean(preview?.reviewedAt && preview.boundaries.every((boundary) => boundary.status === 'approved'));
}

function duration(seconds: number) {
  const sign = seconds < 0 ? '−' : seconds > 0 ? '+' : '';
  const safe = Math.abs(seconds);
  return `${sign}${Math.floor(safe / 60)}:${String(Math.round(safe % 60)).padStart(2, '0')}`;
}

export default function SourceStoryVersionPanel({ onMessage }: Props) {
  const assembly = useEditorStore((state) => state.storyAssembly);
  const versions = useEditorStore((state) => state.storyAssemblyVersions);
  const sources = useEditorStore((state) => state.sourceMedia);
  const director = useEditorStore((state) => state.director);
  const setVersions = useEditorStore((state) => state.setStoryAssemblyVersions);
  const setAssembly = useEditorStore((state) => state.setStoryAssembly);
  const updateSourceMedia = useEditorStore((state) => state.updateSourceMedia);
  const selection = useEditorStore((state) => state.storyVersionSelection);
  const setSelection = useEditorStore((state) => state.setStoryVersionSelection);
  const [note, setNote] = useState('');
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [leftUrl, setLeftUrl] = useState('');
  const [rightUrl, setRightUrl] = useState('');
  const [rationale, setRationale] = useState('');
  const [rejectedReason, setRejectedReason] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffPath, setHandoffPath] = useState('');
  const [refinedImport, setRefinedImport] = useState<ReturnType<typeof importRefinedStoryEdl> | null>(null);
  const historyEpoch = useEditorHistoryStore((s) => s.epoch);
  useEffect(() => { setRefinedImport(null); }, [historyEpoch]);
  const leftVideoRef = useRef<HTMLVideoElement>(null);
  const rightVideoRef = useRef<HTMLVideoElement>(null);
  const refinedInputRef = useRef<HTMLInputElement>(null);
  const bridge = (window as Window & { hyperframesElectron?: PreviewBridge }).hyperframesElectron;
  const readiness = useMemo(() => assembly ? sourceStoryAssemblyReadiness(assembly, sources, director.updatedAt) : null, [assembly, sources, director.updatedAt]);
  const left = versions.find((version) => version.id === leftId);
  const right = versions.find((version) => version.id === rightId);
  const diff = useMemo(() => left && right && left.id !== right.id ? compareSourceStoryVersions(left, right) : null, [left, right]);
  const sharedRoles = useMemo(() => {
    if (!left || !right) return [];
    const leftRoles = roleOffsets(left);
    const rightRoles = roleOffsets(right);
    return (Object.keys(roleNames) as NarrativeRole[]).filter((role) => leftRoles.has(role) && rightRoles.has(role));
  }, [left, right]);

  useEffect(() => {
    if (!versions.length) { setLeftId(''); setRightId(''); return; }
    if (!versions.some((version) => version.id === rightId)) setRightId(versions[versions.length - 1].id);
    if (!versions.some((version) => version.id === leftId)) setLeftId(versions[versions.length - 2]?.id ?? versions[0].id);
  }, [leftId, rightId, versions]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLeftUrl('');
      setRightUrl('');
      if (!bridge) return;
      const [leftResult, rightResult] = await Promise.allSettled([
        left?.assembly.preview?.path ? bridge.registerSourceMedia(left.assembly.preview.path) : Promise.reject(new Error('missing')),
        right?.assembly.preview?.path ? bridge.registerSourceMedia(right.assembly.preview.path) : Promise.reject(new Error('missing')),
      ]);
      if (!active) return;
      if (leftResult.status === 'fulfilled') setLeftUrl(leftResult.value.url);
      if (rightResult.status === 'fulfilled') setRightUrl(rightResult.value.url);
    };
    void load();
    return () => { active = false; };
  }, [bridge, left?.assembly.preview?.path, right?.assembly.preview?.path]);

  const save = () => {
    if (!assembly || !readiness?.complete) return;
    try {
      const version = createSourceStoryVersion(assembly, sources, versions, note);
      setVersions([...versions, version]);
      setNote('');
      setLeftId(versions[versions.length - 1]?.id ?? version.id);
      setRightId(version.id);
      onMessage(`已冻结 ${version.label}；后续结构修订不会改动这个版本。`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const restore = (versionId: string) => {
    const version = versions.find((item) => item.id === versionId);
    if (!version || assembly?.appliedBlockIds?.length) return;
    if (!window.confirm(`恢复“${version.label}”？当前未保存的全局结构会被替换，但正式时间轴和源片保留/排除结论不会改变。`)) return;
    try {
      const restored = restoreSourceStoryVersion(version, sources, director);
      restored.sources.forEach((source, index) => {
        if (source !== sources[index]) updateSourceMedia(source.id, { roughCutPlan: source.roughCutPlan });
      });
      setAssembly(restored.assembly);
      onMessage(`已恢复 ${version.label}。为安全起见，视觉结论发生变化的切点需要重检，结构和预览也要重新确认。`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const seekRole = (role: NarrativeRole) => {
    if (!left || !right) return;
    const leftTime = roleOffsets(left).get(role);
    const rightTime = roleOffsets(right).get(role);
    if (leftVideoRef.current && leftTime !== undefined) leftVideoRef.current.currentTime = leftTime;
    if (rightVideoRef.current && rightTime !== undefined) rightVideoRef.current.currentTime = rightTime;
  };

  const playTogether = () => {
    void leftVideoRef.current?.play();
    void rightVideoRef.current?.play();
  };

  const pauseTogether = () => {
    leftVideoRef.current?.pause();
    rightVideoRef.current?.pause();
  };

  const syncNormalized = (from: 'left' | 'right') => {
    const source = from === 'left' ? leftVideoRef.current : rightVideoRef.current;
    const target = from === 'left' ? rightVideoRef.current : leftVideoRef.current;
    if (!source || !target || !source.duration || !target.duration) return;
    target.currentTime = source.currentTime / source.duration * target.duration;
  };

  const chooseWinner = (winner: SourceStoryAssemblyVersion, loser: SourceStoryAssemblyVersion) => {
    const reason = rationale.trim();
    const rejection = rejectedReason.trim();
    if (!reason || !rejection) return onMessage('请同时写清胜出理由和另一个方案的淘汰理由。');
    if (!previewApproved(winner) || !previewApproved(loser)) return onMessage('两个方案都必须保存已完整确认的结构预览，才能做最终选版。');
    setSelection({ winnerVersionId: winner.id, comparedVersionIds: [left!.id, right!.id], rationale: reason, rejectedReasons: { ...(selection?.rejectedReasons ?? {}), [loser.id]: rejection }, selectedAt: new Date().toISOString() });
    onMessage(`${winner.label} 已被指定为胜出方案。正式发布前请恢复它、重新确认并装配到时间轴。`);
  };

  const exportHandoff = async () => {
    if (handoffBusy) return;
    if (!bridge?.exportWinningStoryHandoff) return onMessage('精剪交接包需要从 HyperFrames 桌面版导出。');
    setHandoffBusy(true);
    try {
      const payload = createWinningStoryHandoff(useEditorStore.getState().exportSnapshot());
      const result = await bridge.exportWinningStoryHandoff(payload);
      if (result.canceled || !result.outputPath) return onMessage('已取消导出精剪交接包。');
      setHandoffPath(result.outputPath);
      onMessage(`胜出方案交接包已导出：${result.fileCount ?? 7} 个文件，${result.sourceCount ?? payload.sources.length} 条原片已通过校验。`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setHandoffBusy(false);
    }
  };

  const inspectRefinedEdl = async (file?: File) => {
    if (!file || !selection) return;
    const revision = useEditorHistoryStore.getState().revision;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('精剪时间线超过 5MB；请确认没有把媒体或转写正文误写进文件。');
      const winner = versions.find((version) => version.id === selection.winnerVersionId);
      if (!winner) throw new Error('当前胜出方案已经失效。');
      const text = await file.text(); const isFcpxml = /\.fcpxml$|\.xml$/i.test(file.name);
      const parsed = isFcpxml ? fcpxmlToEdl(text, winner, sources) : JSON.parse(text) as unknown;
      if (useEditorHistoryStore.getState().revision !== revision) throw new Error('读取期间工程已变化，请重新导入。');
      const inbox = inspectExternalClips(parsed, winner, sources, file.name);
      if (inbox.clips.length || inbox.externalTimeline) {
        const state = useEditorStore.getState();
        state.setExternalClipInboxes([...state.externalClipInboxes, inbox]);
        setRefinedImport(null);
        onMessage(`已进入待审收件箱：${inbox.clips.length} 个新增片段${inbox.externalTimeline ? '，并保留完整 OTIO 时间线' : ''}。请确认审核与差异后保存。`);
        return;
      }
      const result = importRefinedStoryEdl(parsed, winner, sources, versions, file.name);
      if (isFcpxml && result.version.provenance) { result.version.provenance.kind = 'external-fcpxml'; result.version.note = `FCPXML 外部时间线 · 基于 ${winner.label}`; }
      setRefinedImport(result);
      onMessage(`已完成精剪 ${isFcpxml ? 'FCPXML' : 'EDL'} 对比；确认差异后再保存，不会覆盖原胜出方案。`);
    } catch (error) {
      setRefinedImport(null);
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (refinedInputRef.current) refinedInputRef.current.value = '';
    }
  };

  const saveRefinedVersion = () => {
    if (!refinedImport || !selection) return;
    setVersions([...versions, refinedImport.version]);
    setLeftId(selection.winnerVersionId);
    setRightId(refinedImport.version.id);
    onMessage(`已保存 ${refinedImport.version.label}，来源是外部精剪 EDL。原胜出方案保持不变；请恢复新方案并重新做切点检查与预演。`);
    setRefinedImport(null);
  };

  const exportOtio = (version: SourceStoryAssemblyVersion) => {
    try {
      const document = createOtioTimeline(version, sources, useEditorStore.getState().projectName, useEditorStore.getState().canvas.fps);
      const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${version.label.replace(/[<>:"/\\|?*]/g, '-')}.otio`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onMessage('已导出 OTIO 时间线；原片仍为本地路径引用。');
    } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  };
  const exportFcpxml = (version: SourceStoryAssemblyVersion) => {
    try {
      const document = createFcpxmlTimeline(version, sources, useEditorStore.getState().projectName, useEditorStore.getState().canvas.fps);
      const url = URL.createObjectURL(new Blob([document], { type: 'application/xml' }));
      const link = window.document.createElement('a'); link.href = url; link.download = `${version.label.replace(/[<>:"/\\|?*]/g, '-')}.fcpxml`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); onMessage('已导出 FCPXML 1.10 主故事线；原片仍为本地路径引用。');
    } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  };

  if (!assembly) return <ExternalClipInboxPanel onMessage={onMessage} />;
  return <div className="mt-1.5 rounded border border-indigo-300/20 bg-indigo-300/[0.035] p-1.5">
    <div className="flex items-start justify-between gap-1.5"><div><p className="text-[8.5px] font-medium text-indigo-100">粗剪方案版本</p><p className="text-[7.5px] text-ink-faint">冻结结构与切点，用于比较和安全回退；不会复制原片。</p></div><span className="rounded border border-indigo-300/20 px-1 py-0.5 text-[7.5px] text-indigo-100">{versions.length} 个方案</span></div>
    <div className="mt-1.5 flex gap-1"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="这版为什么成立（可选）" className="min-w-0 flex-1 rounded border border-stroke bg-panel px-1.5 py-1 text-[8px] text-ink outline-none" /><button type="button" onClick={save} disabled={!readiness?.complete} className="rounded bg-indigo-600 px-1.5 py-1 text-[8px] text-white disabled:opacity-40">保存为新方案</button></div>
    {versions.length > 0 && <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">{versions.map((version) => {
      const total = version.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
      return <div key={version.id} className="flex items-center gap-1 rounded border border-stroke bg-panel/60 p-1"><div className="min-w-0 flex-1"><p className="text-[8px] text-indigo-100">{version.label} · {version.segments.length} 段 · {duration(total).replace(/^\+/, '')}{selection?.winnerVersionId === version.id ? ' · 胜出' : ''}</p><p className="truncate text-[7px] text-ink-faint">{version.note || new Date(version.createdAt).toLocaleString()}</p></div><button type="button" disabled={Boolean(assembly.appliedBlockIds?.length)} onClick={() => restore(version.id)} className="rounded border border-indigo-300/20 px-1.5 py-0.5 text-[7.5px] text-indigo-100 disabled:opacity-40">恢复</button></div>;
    })}</div>}
    {versions.length >= 2 && <div className="mt-1.5 rounded border border-stroke bg-panel/50 p-1.5"><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1"><select value={leftId} onChange={(event) => setLeftId(event.target.value)} className="min-w-0 rounded border border-stroke bg-panel px-1 py-0.5 text-[7.5px] text-ink">{versions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}</select><span className="text-[7px] text-ink-faint">对比</span><select value={rightId} onChange={(event) => setRightId(event.target.value)} className="min-w-0 rounded border border-stroke bg-panel px-1 py-0.5 text-[7.5px] text-ink">{versions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}</select></div>{diff && <><p className="mt-1 text-[7.5px] leading-relaxed text-ink-faint">新增 {diff.added} · 移除 {diff.removed} · 换位 {diff.moved} · 职责变化 {diff.roleChanged} · 切点变化 {diff.boundaryChanged} · 位置替换 {diff.replacedPositions}<br />时长 {duration(diff.leftDuration).replace(/^\+/, '')} → {duration(diff.rightDuration).replace(/^\+/, '')}（{duration(diff.durationDelta)}）· 来源 {diff.leftSources} → {diff.rightSources}</p>
      <div className="mt-1.5 grid grid-cols-2 gap-1">{leftUrl ? <video ref={leftVideoRef} src={leftUrl} controls preload="metadata" className="aspect-video w-full rounded bg-black object-contain" /> : <div className="flex aspect-video items-center justify-center rounded bg-black/50 text-[7px] text-ink-faint">{left?.label} 没有可用预览</div>}{rightUrl ? <video ref={rightVideoRef} src={rightUrl} controls preload="metadata" className="aspect-video w-full rounded bg-black object-contain" /> : <div className="flex aspect-video items-center justify-center rounded bg-black/50 text-[7px] text-ink-faint">{right?.label} 没有可用预览</div>}</div>
      <div className="mt-1 flex flex-wrap gap-1"><button type="button" onClick={playTogether} disabled={!leftUrl || !rightUrl} className="rounded border border-stroke px-1 py-0.5 text-[7px] text-ink-faint disabled:opacity-30">同时播放</button><button type="button" onClick={pauseTogether} className="rounded border border-stroke px-1 py-0.5 text-[7px] text-ink-faint">同时暂停</button><button type="button" onClick={() => syncNormalized('left')} className="rounded border border-stroke px-1 py-0.5 text-[7px] text-ink-faint">按左侧进度同步</button><button type="button" onClick={() => syncNormalized('right')} className="rounded border border-stroke px-1 py-0.5 text-[7px] text-ink-faint">按右侧进度同步</button>{sharedRoles.map((role) => <button type="button" key={role} onClick={() => seekRole(role)} className="rounded border border-indigo-300/20 px-1 py-0.5 text-[7px] text-indigo-100">同步到{roleNames[role]}</button>)}</div>
      <div className="mt-1.5 grid grid-cols-2 gap-1"><input value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="胜出理由（必填）" className="rounded border border-stroke bg-panel px-1 py-1 text-[7.5px] text-ink outline-none" /><input value={rejectedReason} onChange={(event) => setRejectedReason(event.target.value)} placeholder="另一个方案淘汰理由（必填）" className="rounded border border-stroke bg-panel px-1 py-1 text-[7.5px] text-ink outline-none" /></div>
      <div className="mt-1 flex gap-1"><button type="button" disabled={!left || !right || left.id === right.id || !rationale.trim() || !rejectedReason.trim()} onClick={() => left && right && chooseWinner(left, right)} className="flex-1 rounded border border-indigo-300/25 px-1 py-1 text-[7.5px] text-indigo-100 disabled:opacity-35">选择 {left?.label} 胜出</button><button type="button" disabled={!left || !right || left.id === right.id || !rationale.trim() || !rejectedReason.trim()} onClick={() => left && right && chooseWinner(right, left)} className="flex-1 rounded border border-indigo-300/25 px-1 py-1 text-[7.5px] text-indigo-100 disabled:opacity-35">选择 {right?.label} 胜出</button></div>
      {selection && <div className="mt-1.5 rounded border border-emerald-300/20 bg-emerald-300/[0.04] p-1"><div className="flex items-center gap-1"><p className="min-w-0 flex-1 text-[7.5px] text-emerald-100">当前胜出：{versions.find((version) => version.id === selection.winnerVersionId)?.label ?? '已失效'} · {selection.rationale}</p><button type="button" disabled={Boolean(assembly.appliedBlockIds?.length)} onClick={() => restore(selection.winnerVersionId)} className="shrink-0 rounded border border-emerald-300/25 px-1 py-0.5 text-[7px] text-emerald-100 disabled:opacity-40">恢复胜出方案</button></div><div className="mt-1 flex flex-wrap items-center gap-1"><button type="button" disabled={handoffBusy || !assembly.appliedBlockIds?.length} onClick={() => void exportHandoff()} className="rounded bg-emerald-600 px-1.5 py-1 text-[7.5px] text-white disabled:opacity-35">{handoffBusy ? '正在校验原片…' : '导出精剪交接包'}</button>{handoffPath && bridge?.revealPath && <button type="button" onClick={() => void bridge.revealPath?.(handoffPath)} className="rounded border border-emerald-300/25 px-1.5 py-1 text-[7px] text-emerald-100">打开目录</button>}<input ref={refinedInputRef} type="file" accept="application/json,application/xml,text/xml,.json,.otio,.fcpxml,.xml" className="hidden" onChange={(event) => void inspectRefinedEdl(event.target.files?.[0])} /><button type="button" onClick={() => refinedInputRef.current?.click()} className="rounded border border-emerald-300/25 px-1.5 py-1 text-[7px] text-emerald-100">导回 EDL / OTIO / FCPXML</button><span className="text-[7px] text-ink-faint">不复制原片，不覆盖胜出版本</span></div>{refinedImport && <div className="mt-1 rounded border border-amber-300/20 bg-amber-300/[0.04] p-1"><p className="text-[7.5px] leading-relaxed text-amber-100">待保存：删除 {refinedImport.diff.removed} · 换位 {refinedImport.diff.moved} · 切点变化 {refinedImport.diff.boundaryChanged} · 职责变化 {refinedImport.diff.roleChanged} · 时长 {duration(refinedImport.diff.durationDelta)}</p><div className="mt-1 flex gap-1"><button type="button" onClick={saveRefinedVersion} className="rounded bg-amber-600 px-1.5 py-0.5 text-[7px] text-white">保存为派生方案</button><button type="button" onClick={() => setRefinedImport(null)} className="rounded border border-stroke px-1.5 py-0.5 text-[7px] text-ink-faint">取消</button></div></div>}</div>}
    </>}</div>}
    <ExternalClipInboxPanel onMessage={onMessage} />
    {versions.length > 0 && <details className="mt-2 space-y-1 text-[8px] text-ink"><summary>公开时间线（OTIO / FCPXML）</summary>{versions.map((version) => <div key={version.id} className="space-y-1 border border-stroke p-1"><p>{version.label} · {version.note}</p>{version.externalTimeline && <OtioTimelineSummary timeline={version.externalTimeline} />}<div className="flex gap-1"><button type="button" onClick={() => exportOtio(version)} className="rounded border border-sky-300/30 px-2 py-1">{version.externalTimeline ? '重新导出完整 OTIO' : '导出 OTIO'}</button><button type="button" onClick={() => exportFcpxml(version)} className="rounded border border-sky-300/30 px-2 py-1">导出 FCPXML</button></div></div>)}</details>}
  </div>;
}
