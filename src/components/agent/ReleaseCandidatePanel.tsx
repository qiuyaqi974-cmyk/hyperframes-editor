import { useEffect, useMemo, useRef, useState } from 'react';
import { loadDirectorLearningRecords, loadPostPublishExperiments, loadPostPublishObservations, loadReleaseCandidates, saveReleaseCandidate } from '@/lib/persistence';
import { analyzeProjectHealth } from '@/lib/projectHealth';
import { compareWithReleaseCandidate, createReleaseCandidate, type ReleaseCandidate } from '@/lib/releaseCandidate';
import { useEditorStore } from '@/store/editorStore';
import { generateHyperFramesHtml } from '@/lib/exportHtml';
import { createReleaseRenderRequest, type ReleaseRenderProgress, type ReleaseRenderRequest, type ReleaseRenderResult, type ReleaseRenderStatusSnapshot } from '@/lib/releaseRender';
import { materializeExternalMediaForRender } from '@/lib/sourceMedia';
import { createReleaseDeliveryPackage, type DeliveryPackagePayload } from '@/lib/exportDeliveryPackage';
import StoryLineagePanel from './StoryLineagePanel';
import PublicationAuditReportPanel from './PublicationAuditReportPanel';
import type { StoryLineageEvidence } from '@/lib/storyLineage';

interface ReleaseRenderBridge {
  startReleaseRender: (request: ReleaseRenderRequest) => Promise<{ canceled: boolean; jobId?: string; outputPath?: string }>;
  cancelReleaseRender: (jobId: string) => Promise<{ canceled: boolean }>;
  getReleaseRenderStatus: () => Promise<ReleaseRenderStatusSnapshot>;
  onReleaseRenderProgress: (listener: (progress: ReleaseRenderProgress) => void) => () => void;
  onReleaseRenderResult: (listener: (result: ReleaseRenderResult) => void) => () => void;
  revealPath: (path: string) => Promise<string>;
  exportDeliveryPackage: (payload: DeliveryPackagePayload) => Promise<{ canceled: boolean; outputPath?: string }>;
}

function signed(value: number, suffix = '') {
  if (!value) return `0${suffix}`;
  return `${value > 0 ? '+' : ''}${value}${suffix}`;
}

export default function ReleaseCandidatePanel({ onClose, openSignal = 0 }: { onClose?: () => void; openSignal?: number }) {
  const blocks = useEditorStore((state) => state.blocks);
  const assets = useEditorStore((state) => state.assets);
  const sourceMedia = useEditorStore((state) => state.sourceMedia);
  const scenes = useEditorStore((state) => state.scenes);
  const reviews = useEditorStore((state) => state.reviews);
  const narration = useEditorStore((state) => state.narration);
  const director = useEditorStore((state) => state.director);
  const canvas = useEditorStore((state) => state.canvas);
  const projectName = useEditorStore((state) => state.projectName);
  const themeId = useEditorStore((state) => state.themeId);
  const storyAssembly = useEditorStore((state) => state.storyAssembly);
  const storyAssemblyVersions = useEditorStore((state) => state.storyAssemblyVersions);
  const storyVersionSelection = useEditorStore((state) => state.storyVersionSelection);
  const externalClipInboxes = useEditorStore((state) => state.externalClipInboxes);
  const [expanded, setExpanded] = useState(false);
  const [candidates, setCandidates] = useState<ReleaseCandidate[]>([]);
  const [lineageEvidence, setLineageEvidence] = useState<Omit<StoryLineageEvidence, 'candidates'>>({ observations: [], experiments: [], learningRecords: [] });
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [renderJobId, setRenderJobId] = useState('');
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderState, setRenderState] = useState<'idle' | 'rendering' | 'completed' | 'failed' | 'canceled'>('idle');
  const [renderError, setRenderError] = useState('');
  const [renderOutputPath, setRenderOutputPath] = useState('');
  const [renderReportPath, setRenderReportPath] = useState('');
  const [renderSha256, setRenderSha256] = useState('');
  const [renderCandidateLabel, setRenderCandidateLabel] = useState('');
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryOutputPath, setDeliveryOutputPath] = useState('');
  const renderCandidateIdRef = useRef('');
  const bridge = (window as Window & { hyperframesElectron?: ReleaseRenderBridge }).hyperframesElectron;

  const snapshot = useMemo(() => ({
    app: 'hyperframes-editor' as const,
    version: 4,
    themeId,
    projectName,
    canvas,
    blocks,
    assets,
    sourceMedia,
    storyAssembly,
    storyAssemblyVersions,
    storyVersionSelection,
    externalClipInboxes,
    narration,
    scenes,
    reviews,
    director,
    updatedAt: new Date().toISOString(),
  }), [assets, blocks, canvas, director, narration, projectName, reviews, scenes, sourceMedia, themeId, storyAssembly, storyAssemblyVersions, storyVersionSelection, externalClipInboxes]);
  const health = useMemo(() => analyzeProjectHealth(snapshot), [snapshot]);
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
  const comparison = useMemo(
    () => selected ? compareWithReleaseCandidate(snapshot, selected) : null,
    [selected, snapshot],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([loadReleaseCandidates(), loadPostPublishObservations(), loadPostPublishExperiments(), loadDirectorLearningRecords()])
      .then(([items, observations, experiments, learningRecords]) => {
        if (!active) return;
        setCandidates(items);
        setLineageEvidence({ observations, experiments, learningRecords });
        setSelectedId(renderCandidateIdRef.current || items[0]?.id || '');
      })
      .catch(() => active && setMessage('发布候选历史读取失败。'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (openSignal > 0) setExpanded(true);
  }, [openSignal]);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getReleaseRenderStatus().then((status) => {
      setRenderJobId(status.jobId);
      setRenderProgress(status.percent);
      setRenderState(status.status);
      setRenderOutputPath(status.outputPath ?? '');
      setRenderReportPath(status.reportPath ?? '');
      setRenderSha256(status.sha256 ?? '');
      setRenderError(status.error ?? '');
      setRenderCandidateLabel(status.candidateLabel ?? '');
      if (status.candidateId) {
        renderCandidateIdRef.current = status.candidateId;
        setSelectedId(status.candidateId);
      }
    });
    const offProgress = bridge.onReleaseRenderProgress((progress) => {
      setRenderJobId(progress.jobId);
      setRenderProgress(progress.percent);
      setRenderState('rendering');
    });
    const offResult = bridge.onReleaseRenderResult((result) => {
      setRenderJobId(result.jobId);
      if (result.status === 'completed') {
        setRenderProgress(100);
        setRenderState('completed');
        setRenderOutputPath(result.outputPath);
        setRenderReportPath(result.reportPath);
        setRenderSha256(result.sha256);
        const candidateId = renderCandidateIdRef.current;
        setCandidates((current) => {
          const candidate = current.find((item) => item.id === candidateId);
          if (!candidate) return current;
          const updated = {
            ...candidate,
            render: {
              outputPath: result.outputPath,
              reportPath: result.reportPath,
              sha256: result.sha256,
              renderedAt: new Date().toISOString(),
            },
          };
          void saveReleaseCandidate(updated);
          return current.map((item) => item.id === candidateId ? updated : item);
        });
        setMessage(`渲染完成，已生成 MP4 与渲染报告。SHA-256：${result.sha256.slice(0, 12)}…`);
      } else {
        setRenderState(result.status);
        setRenderError(result.error ?? '');
        setMessage(result.status === 'canceled' ? '渲染已取消。' : `渲染失败：${result.error || '未知错误'}`);
      }
    });
    return () => { offProgress(); offResult(); };
  }, [bridge]);

  useEffect(() => {
    if (!selected) return;
    if (selected.render) {
      renderCandidateIdRef.current = selected.id;
      setRenderCandidateLabel(selected.label);
      setRenderState('completed');
      setRenderProgress(100);
      setRenderOutputPath(selected.render.outputPath);
      setRenderReportPath(selected.render.reportPath);
      setRenderSha256(selected.render.sha256);
    } else if (renderCandidateIdRef.current !== selected.id) {
      setRenderState('idle');
      setRenderProgress(0);
      setRenderOutputPath('');
      setRenderReportPath('');
      setRenderSha256('');
    }
  }, [selected?.id]);

  const freezeCandidate = async () => {
    if (health.blockers.length || busy) return;
    setBusy(true);
    setMessage('正在冻结完整工程与导演决策…');
    try {
      const latest = useEditorStore.getState().exportSnapshot();
      if (analyzeProjectHealth(latest).blockers.length) throw new Error('当前工程仍有阻断项，请完成审核后再冻结。');
      const candidate = createReleaseCandidate(latest, candidates);
      await saveReleaseCandidate(candidate);
      const next = [candidate, ...candidates].slice(0, 12);
      setCandidates(next);
      setSelectedId(candidate.id);
      setMessage(`${candidate.label} 已冻结，后续修改不会覆盖它。`);
    } catch (error) {
      setMessage(`冻结失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const restoreCandidate = () => {
    if (!selected) return;
    if (!window.confirm(`恢复 ${selected.label} 会替换当前编辑状态，是否继续？`)) return;
    useEditorStore.getState().importSnapshot(structuredClone(selected.snapshot));
    setMessage(`已恢复 ${selected.label}，候选历史保持不变。`);
    onClose?.();
  };

  const renderCandidate = async () => {
    if (!selected || !bridge || renderState === 'rendering') return;
    setRenderError('');
    setRenderOutputPath('');
    setRenderReportPath('');
    setRenderSha256('');
    setRenderProgress(0);
    setMessage(`正在准备 ${selected.label} 的确定性渲染…`);
    setRenderCandidateLabel(selected.label);
    renderCandidateIdRef.current = selected.id;
    try {
      const html = generateHyperFramesHtml(materializeExternalMediaForRender(selected.snapshot));
      const result = await bridge.startReleaseRender(createReleaseRenderRequest(selected, html));
      if (result.canceled || !result.jobId) {
        setRenderState('idle');
        setMessage('已取消选择输出位置。');
        return;
      }
      setRenderJobId(result.jobId);
      setRenderState('rendering');
    } catch (error) {
      setRenderState('failed');
      setRenderError(error instanceof Error ? error.message : String(error));
      setMessage(`无法启动渲染：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const cancelRender = async () => {
    if (!bridge || !renderJobId) return;
    await bridge.cancelReleaseRender(renderJobId);
    setMessage('正在停止渲染任务…');
  };

  const exportCandidateDelivery = async () => {
    if (!selected || !bridge || deliveryBusy) return;
    const hasMatchingRender = renderState === 'completed'
      && renderCandidateIdRef.current === selected.id
      && Boolean(renderOutputPath && renderReportPath && renderSha256);
    setDeliveryBusy(true);
    setDeliveryOutputPath('');
    setMessage(hasMatchingRender ? `正在打包 ${selected.label}、最终成片和完整追溯记录…` : `正在打包 ${selected.label} 的工程与审片记录…`);
    try {
      const payload = createReleaseDeliveryPackage(selected, hasMatchingRender ? {
        outputPath: renderOutputPath,
        reportPath: renderReportPath,
        sha256: renderSha256,
        renderedAt: selected.render?.renderedAt,
      } : undefined);
      const result = await bridge.exportDeliveryPackage(payload);
      if (result.canceled || !result.outputPath) {
        setMessage('已取消 RC 交付包导出。');
        return;
      }
      setDeliveryOutputPath(result.outputPath);
      setMessage(hasMatchingRender
        ? `${selected.label} 完整交付包已生成，包含最终 MP4、报告、哈希和审片记录。`
        : `${selected.label} 工程交付包已生成；当前没有与它匹配的最终渲染文件。`);
    } catch (error) {
      setMessage(`RC 交付失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeliveryBusy(false);
    }
  };

  const badge = !selected
    ? { text: '尚未冻结', style: 'border-stroke text-ink-faint' }
    : comparison?.changed
      ? { text: '当前稿已修改', style: 'border-amber-300/30 bg-amber-300/10 text-amber-100' }
      : { text: `匹配 ${selected.label}`, style: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100' };

  return (
    <section className="rounded-lg border border-stroke bg-panel-2/70 p-2.5" aria-label="发布候选版本">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left">
        <span className="text-[11px] font-semibold text-ink">发布候选版本</span>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] ${badge.style}`}>{badge.text}</span>
        <span className="ml-auto text-[11px] text-ink-faint">{expanded ? '−' : '+'}</span>
      </button>
      {selected && (
        <div className="mt-1.5 text-[9.5px] text-ink-faint"><p>{selected.label} · {new Date(selected.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>{selected.storyDecision && <p className="mt-0.5 text-emerald-200/80">绑定导演选版：{selected.storyDecision.label} · {selected.storyDecision.rationale}</p>}</div>
      )}

      {expanded && (
        <div className="mt-2.5 space-y-2.5 border-t border-stroke pt-2.5">
          {candidates.length > 0 && (
            <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} disabled={renderState === 'rendering'} className="w-full rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] text-ink outline-none disabled:opacity-50">
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.projectName}</option>
              ))}
            </select>
          )}

          {selected && comparison && (
            <div className="rounded-md border border-stroke bg-panel/70 p-2">
              <div className="mb-1.5 flex items-center justify-between text-[10px]">
                <span className="font-semibold text-ink-dim">当前稿 vs {selected.label}</span>
                <span className={comparison.changed ? 'text-amber-200' : 'text-emerald-200'}>{comparison.changed ? '存在改动' : '完全一致'}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9.5px] text-ink-faint">
                <span>积木 <b className="font-normal text-ink-dim">+{comparison.blocks.added} / -{comparison.blocks.removed} / 改{comparison.blocks.changed}</b></span>
                <span>场景 <b className="font-normal text-ink-dim">+{comparison.scenes.added} / -{comparison.scenes.removed} / 改{comparison.scenes.changed}</b></span>
                <span>时长 <b className="font-normal text-ink-dim">{signed(comparison.durationDelta, 's')}</b></span>
                <span>素材 <b className="font-normal text-ink-dim">{signed(comparison.assetsDelta)}</b></span>
                <span>制作风险 <b className="font-normal text-ink-dim">{signed(comparison.healthDelta.warnings)}</b></span>
                <span>导演约束 <b className={`font-normal ${comparison.directorChanged ? 'text-violet-200' : 'text-ink-dim'}`}>{comparison.directorChanged ? '已改动' : '未改动'}</b></span>
                <span>审片决策 <b className={`font-normal ${comparison.reviewChanged ? 'text-amber-200' : 'text-ink-dim'}`}>{comparison.reviewChanged ? '已改动' : '未改动'}</b></span>
                <span>导演选版 <b className={`font-normal ${comparison.storyDecisionChanged ? 'text-emerald-200' : 'text-ink-dim'}`}>{comparison.storyDecisionChanged ? '已改动' : '未改动'}</b></span>
              </div>
              {(comparison.healthDelta.blockers !== 0 || comparison.healthDelta.directorIssues !== 0) && (
                <p className="mt-1.5 border-t border-stroke pt-1.5 text-[9.5px] text-ink-faint">阻断 {signed(comparison.healthDelta.blockers)} · 导演问题 {signed(comparison.healthDelta.directorIssues)}</p>
              )}
            </div>
          )}

          <div className="flex gap-1.5">
            <button type="button" onClick={() => void freezeCandidate()} disabled={busy || health.blockers.length > 0} className="min-w-0 flex-1 rounded-md border border-emerald-300/35 bg-emerald-300/10 px-2 py-1.5 text-[10.5px] font-medium text-emerald-100 hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-45">
              {busy ? '冻结中…' : selected ? '冻结为新 RC' : '建立首个 RC'}
            </button>
            {selected && <button type="button" onClick={restoreCandidate} className="rounded-md border border-stroke px-2 py-1.5 text-[10px] text-ink-dim hover:text-ink">恢复</button>}
          </div>
          {selected && (
            <div className="rounded-md border border-emerald-300/20 bg-emerald-300/[0.04] p-2">
              <div className="mb-1.5 flex items-center justify-between text-[10px]">
                <span className="font-semibold text-emerald-100">确定性 MP4 渲染</span>
                <span className="font-mono text-ink-faint">{renderState === 'rendering' ? `${renderCandidateLabel || selected.label} · ${renderProgress}%` : renderCandidateLabel || selected.label}</span>
              </div>
              {renderState === 'rendering' && (
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-panel-3">
                  <div className="h-full rounded-full bg-emerald-400 transition-[width]" style={{ width: `${renderProgress}%` }} />
                </div>
              )}
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void renderCandidate()} disabled={!bridge || renderState === 'rendering'} className="min-w-0 flex-1 rounded-md bg-emerald-500 px-2 py-1.5 text-[10.5px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
                  {renderState === 'rendering' ? '正在渲染…' : renderState === 'failed' || renderState === 'canceled' ? `重试渲染 ${selected.label}` : `渲染 ${selected.label}`}
                </button>
                {renderState === 'rendering' && <button type="button" onClick={() => void cancelRender()} className="rounded-md border border-red-300/30 px-2 py-1.5 text-[10px] text-red-200">取消</button>}
                {renderState === 'completed' && renderOutputPath && bridge && <button type="button" onClick={() => void bridge.revealPath(renderOutputPath)} className="rounded-md border border-stroke px-2 py-1.5 text-[10px] text-ink-dim hover:text-ink">打开文件</button>}
              </div>
              {!bridge && <p className="mt-1.5 text-[9px] text-ink-faint">请从 HyperFrames 桌面版启动，浏览器预览不执行本地渲染。</p>}
              {renderError && <p className="mt-1.5 line-clamp-3 text-[9px] leading-relaxed text-red-200/80">{renderError}</p>}
            </div>
          )}
          {selected && (
            <div className="rounded-md border border-cyan-300/20 bg-cyan-300/[0.04] p-2">
              <div className="mb-1.5 flex items-center justify-between text-[10px]"><span className="font-semibold text-cyan-100">RC 可追溯交付包</span><span className="text-ink-faint">{renderState === 'completed' && renderCandidateIdRef.current === selected.id && renderSha256 ? '含最终成片' : '工程与审片记录'}</span></div>
              <button type="button" onClick={() => void exportCandidateDelivery()} disabled={!bridge || deliveryBusy} className="w-full rounded-md border border-cyan-300/35 bg-cyan-300/10 px-2 py-1.5 text-[10.5px] font-medium text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-45">{deliveryBusy ? '正在整理交付包…' : `导出 ${selected.label} 交付包`}</button>
              {!bridge && <p className="mt-1.5 text-[9px] text-ink-faint">桌面版才能复制本地媒体、成片和渲染报告。</p>}
              {deliveryOutputPath && bridge && <button type="button" onClick={() => void bridge.revealPath(deliveryOutputPath)} className="mt-1.5 text-[9.5px] text-cyan-200 underline underline-offset-2">打开 RC 交付文件夹</button>}
            </div>
          )}
          {health.blockers.length > 0 && <p className="text-[9.5px] leading-relaxed text-red-200/80">还有 {health.blockers.length} 个阻断项，修复后才能建立发布候选。</p>}
          {!health.blockers.length && health.issues.length > 0 && <p className="text-[9.5px] leading-relaxed text-amber-100/75">允许带风险冻结；风险数量会写入版本基线，方便后续比较。</p>}
          {message && <p className="text-[9.5px] leading-relaxed text-cyan-100/80">{message}</p>}
          <p className="text-[9px] leading-relaxed text-ink-faint">最多保留最近 12 个不可变候选版本，完整媒体保存在本机 IndexedDB。</p>
        </div>
      )}
      <StoryLineagePanel snapshot={snapshot} candidate={selected} evidence={{ candidates, ...lineageEvidence }} />
      <PublicationAuditReportPanel snapshot={snapshot} candidate={selected} evidence={{ candidates, ...lineageEvidence }} />
    </section>
  );
}
