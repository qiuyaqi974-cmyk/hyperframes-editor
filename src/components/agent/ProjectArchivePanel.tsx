import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import {
  loadDirectorLearningRecords,
  loadImportedProjectArchives,
  loadPostPublishExperiments,
  loadPostPublishBatchRollbacks,
  loadPostPublishBatchSessions,
  loadPostPublishObservations,
  loadRecoveryCheckpoints,
  loadReleaseCandidates,
  restoreArchiveCollections,
  saveAutosave,
  saveImportedProjectArchive,
  saveRecoveryCheckpoint,
} from '@/lib/persistence';
import {
  createSelectiveProjectArchive,
  createRecoveredProjectSnapshot,
  confirmArchiveSourceRelocation,
  parseProjectArchive,
  previewProjectArchive,
  planProjectArchiveDisclosure,
  reviewArchiveSourceRelocation,
  validateArchiveSourceRelocations,
  type ArchiveSourceInspection,
  type ArchiveSourceRelocationReview,
  type ConfirmedArchiveSourceRelocation,
  type ProjectArchiveRestorePreview,
  type ArchiveDisclosurePlan,
  type ArchiveDisclosureSelection,
} from '@/lib/projectArchive';
import { archiveRestoreAuditFileType, archiveRestoreAuditToHtml, createArchiveRestoreAudit, readVerifiedArchiveRestoreAuditText, verifyArchiveRestoreAuditText, type ArchiveRestoreAuditReport, type ArchiveRestoreAuditVerification } from '@/lib/archiveRestoreAudit';
import { archiveRestoreAuditDiffFileType, archiveRestoreAuditDiffToHtml, createArchiveRestoreAuditDiff, verifyArchiveRestoreAuditDiffText, type ArchiveRestoreAuditDiffReport, type ArchiveRestoreAuditDiffVerification } from '@/lib/archiveRestoreAuditDiff';

interface ArchiveBridge {
  inspectArchiveSourceReferences?: (paths: string[]) => Promise<ArchiveSourceInspection[]>;
  selectArchiveRelocationCandidate?: () => Promise<{ canceled: boolean; inspection?: ArchiveSourceInspection }>;
}

const statusLabel = {
  verified: '哈希已核对',
  'available-unverified': '仅大小可核对',
  missing: '原路径离线',
  changed: '疑似错版',
};

function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 80) || 'hyperframes-project';
}

function downloadJson(value: unknown, filename: string) {
  downloadText(`${JSON.stringify(value, null, 2)}\n`, filename, 'application/json');
}

function downloadText(value: string, filename: string, type: string) {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function inspect(paths: string[]) {
  const bridge = (window as Window & { hyperframesElectron?: ArchiveBridge }).hyperframesElectron;
  return bridge?.inspectArchiveSourceReferences ? bridge.inspectArchiveSourceReferences(paths) : [];
}

async function collections() {
  const [releaseCandidates, postPublishObservations, postPublishExperiments, directorLearning, postPublishBatchSessions, postPublishBatchRollbacks] = await Promise.all([
    loadReleaseCandidates(), loadPostPublishObservations(), loadPostPublishExperiments(), loadDirectorLearningRecords(), loadPostPublishBatchSessions(), loadPostPublishBatchRollbacks(),
  ]);
  return { releaseCandidates, postPublishObservations, postPublishExperiments, directorLearning, postPublishBatchSessions, postPublishBatchRollbacks };
}

export default function ProjectArchivePanel() {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ProjectArchiveRestorePreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [relocationReviews, setRelocationReviews] = useState<Record<string, ArchiveSourceRelocationReview>>({});
  const [relocations, setRelocations] = useState<Record<string, ConfirmedArchiveSourceRelocation>>({});
  const [relocationConfirmations, setRelocationConfirmations] = useState<Record<string, boolean>>({});
  const [savedCounts, setSavedCounts] = useState({ archives: 0, checkpoints: 0 });
  const [disclosure, setDisclosure] = useState<ArchiveDisclosureSelection>({ publicationEvidence: false, directorLearning: false, batchAudit: false });
  const [exportPlan, setExportPlan] = useState<ArchiveDisclosurePlan>();
  const [dependencyAccepted, setDependencyAccepted] = useState(false);
  const [restoreAudit, setRestoreAudit] = useState<ArchiveRestoreAuditReport>();
  const [auditVerification, setAuditVerification] = useState<ArchiveRestoreAuditVerification>();
  const auditVerificationInput = useRef<HTMLInputElement>(null);
  const [auditDiffLeft, setAuditDiffLeft] = useState<{ fileName: string; verification: ArchiveRestoreAuditVerification; report?: ArchiveRestoreAuditReport }>();
  const [auditDiffRight, setAuditDiffRight] = useState<{ fileName: string; verification: ArchiveRestoreAuditVerification; report?: ArchiveRestoreAuditReport }>();
  const [auditDiff, setAuditDiff] = useState<ArchiveRestoreAuditDiffReport>();
  const [auditDiffVerification, setAuditDiffVerification] = useState<ArchiveRestoreAuditDiffVerification>();
  const auditDiffLeftInput = useRef<HTMLInputElement>(null);
  const auditDiffRightInput = useRef<HTMLInputElement>(null);
  const auditDiffVerificationInput = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshSavedCounts = async () => {
    const [archives, checkpoints] = await Promise.all([loadImportedProjectArchives(), loadRecoveryCheckpoints()]);
    setSavedCounts({ archives: archives.length, checkpoints: checkpoints.length });
  };

  useEffect(() => { if (expanded) void refreshSavedCounts(); }, [expanded]);

  const previewExport = async () => {
    setBusy(true); setMessage('正在计算归档内容与依赖闭包…');
    try {
      const project = useEditorStore.getState().exportSnapshot();
      const stored = await collections();
      const plan = planProjectArchiveDisclosure({ project, ...stored }, disclosure);
      setExportPlan(plan); setDependencyAccepted(false);
      setMessage(plan.blockers.length ? `内容预览发现 ${plan.blockers.length} 个断链阻断项。` : '只读内容预览已生成；尚未导出文件。');
    } catch (error) { setMessage(`内容预览失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const exportArchive = async () => {
    if (!exportPlan || exportPlan.blockers.length || (exportPlan.requiresDependencyAcceptance && !dependencyAccepted)) return;
    setBusy(true); setMessage('正在核对原片引用并生成归档…');
    try {
      const project = useEditorStore.getState().exportSnapshot();
      const stored = await collections();
      const latestPlan = planProjectArchiveDisclosure({ project, ...stored }, disclosure);
      const comparableLatest = structuredClone(latestPlan.sections);
      comparableLatest.project.updatedAt = exportPlan.sections.project.updatedAt;
      if (JSON.stringify(comparableLatest) !== JSON.stringify(exportPlan.sections) || JSON.stringify(latestPlan.policy) !== JSON.stringify(exportPlan.policy)) {
        setExportPlan(latestPlan); setDependencyAccepted(false); throw new Error('工程或独立证据在预览后发生变化，请重新检查内容与依赖闭包。');
      }
      const inspections = await inspect((project.sourceMedia ?? []).map((item) => item.path));
      const archive = await createSelectiveProjectArchive({ project, ...stored }, disclosure, dependencyAccepted, inspections);
      downloadJson(archive, `${safeName(project.projectName)}-${archive.createdAt.slice(0, 10)}.hfarchive.json`);
      const verified = archive.sourceReferences.filter((item) => item.archivedStatus === 'verified').length;
      setMessage(`归档已生成：${archive.sourceReferences.length} 条原片引用，${verified} 条带快速哈希；没有复制长视频。`);
    } catch (error) {
      setMessage(`归档失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  };

  const importArchive = async (file?: File) => {
    if (!file) return;
    setBusy(true); setConfirmed(false); setPreview(undefined); setRestoreAudit(undefined); setRelocationReviews({}); setRelocations({}); setRelocationConfirmations({}); setMessage('正在验证归档与本机素材…');
    try {
      const archive = parseProjectArchive(await file.text());
      const [current, inspections] = await Promise.all([collections(), inspect(archive.sourceReferences.map((item) => item.path))]);
      const next = await previewProjectArchive(archive, useEditorStore.getState().projectName, current, inspections);
      setPreview(next);
      setMessage(next.blockers.length ? `恢复预览发现 ${next.blockers.length} 个阻断项。` : '恢复预览已完成；尚未修改当前工程或独立证据。');
    } catch (error) {
      setMessage(`读取恢复包失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  };

  const chooseRelocation = async (sourceId: string) => {
    if (!preview) return;
    const source = preview.sourceResults.find((item) => item.id === sourceId);
    if (!source) return;
    const bridge = (window as Window & { hyperframesElectron?: ArchiveBridge }).hyperframesElectron;
    if (!bridge?.selectArchiveRelocationCandidate) { setMessage('受控重定位需要在 HyperFrames 桌面版中选择本地视频。'); return; }
    setBusy(true); setMessage(`正在核对“${source.name}”的候选文件…`);
    try {
      const result = await bridge.selectArchiveRelocationCandidate();
      if (result.canceled || !result.inspection) { setMessage('已取消候选文件选择。'); return; }
      const review = reviewArchiveSourceRelocation(source, result.inspection);
      setRestoreAudit(undefined);
      setRelocationReviews((current) => ({ ...current, [sourceId]: review }));
      setRelocations((current) => { const next = { ...current }; delete next[sourceId]; return next; });
      setRelocationConfirmations((current) => ({ ...current, [sourceId]: false }));
      setConfirmed(false);
      setMessage(review.blockers.length ? `候选文件有 ${review.blockers.length} 个不一致，不能建立映射。` : '候选文件核对完成；请人工确认后建立映射。');
    } catch (error) { setMessage(`候选核对失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const confirmRelocation = (sourceId: string) => {
    const review = relocationReviews[sourceId];
    if (!review) return;
    try {
      const mapping = confirmArchiveSourceRelocation(review, Boolean(relocationConfirmations[sourceId]));
      setRestoreAudit(undefined);
      setRelocations((current) => ({ ...current, [sourceId]: mapping }));
      setMessage('重定位映射已确认；只会写入即将恢复的工程副本。');
      setConfirmed(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const restore = async () => {
    if (!preview || !confirmed || preview.blockers.length) return;
    setBusy(true); setMessage('正在保存当前工程检查点并恢复副本…');
    try {
      const current = useEditorStore.getState().exportSnapshot();
      const confirmedRelocations = Object.values(relocations);
      const relocationInspections = confirmedRelocations.length ? await inspect(confirmedRelocations.map((item) => item.candidate.path)) : [];
      validateArchiveSourceRelocations(preview, confirmedRelocations, relocationInspections);
      const restored = createRecoveredProjectSnapshot(preview, new Date(), confirmedRelocations);
      await saveRecoveryCheckpoint(current);
      await restoreArchiveCollections({
        releaseCandidates: preview.archive.sections.releaseCandidates,
        postPublishObservations: preview.archive.sections.postPublishObservations,
        postPublishExperiments: preview.archive.sections.postPublishExperiments,
        directorLearning: preview.archive.sections.directorLearning,
        postPublishBatchSessions: preview.archive.sections.postPublishBatchSessions ?? [],
        postPublishBatchRollbacks: preview.archive.sections.postPublishBatchRollbacks ?? [],
      });
      await saveImportedProjectArchive({ archive: preview.archive, importedAt: new Date().toISOString(), sourceResults: preview.sourceResults, sourceRelocations: confirmedRelocations });
      useEditorStore.getState().importSnapshot(restored);
      await saveAutosave(restored);
      window.dispatchEvent(new Event('hyperframes:learning-source-updated'));
      setMessage(`已打开“${restored.projectName}”。原工程已保存为独立检查点；${confirmedRelocations.length} 条人工确认的重定位仅写入恢复副本。`);
      setPreview(undefined); setConfirmed(false); await refreshSavedCounts();
    } catch (error) {
      setMessage(`恢复失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  };

  const generateRestoreAudit = async () => {
    if (!preview || preview.integrity !== 'verified') return;
    setBusy(true); setMessage('正在重新读取本机记录并生成只读恢复差异审计…');
    try {
      const current = await collections();
      const report = await createArchiveRestoreAudit(preview, current, new Date(), Object.keys(relocationReviews).filter((sourceId) => !relocations[sourceId]));
      setRestoreAudit(report);
      setMessage('只读恢复差异审计已生成；尚未恢复工程、保存检查点或写入归档历史。');
    } catch (error) {
      setRestoreAudit(undefined);
      setMessage(`恢复差异审计失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  };

  const verifyRestoreAudit = async (file?: File) => {
    if (!file) return;
    setBusy(true); setAuditVerification(undefined); setMessage('正在以只读方式复算恢复差异审计哈希…');
    try {
      const result = await verifyArchiveRestoreAuditText(await file.text(), archiveRestoreAuditFileType(file.name, file.type));
      setAuditVerification(result);
      setMessage(result.status === 'verified' ? '恢复差异审计六个数据段与整份哈希全部通过。' : result.status === 'unsupported' ? '恢复差异审计格式、版本或字段不受支持；没有导入任何内容。' : `恢复差异审计验证失败：${result.errors.length} 个问题。`);
    } catch (error) { setMessage(`恢复差异审计验证失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const readAuditDiffSide = async (side: 'left' | 'right', file?: File) => {
    if (!file) return;
    setBusy(true); setAuditDiff(undefined); setMessage(`正在验证${side === 'left' ? '左侧' : '右侧'}恢复差异审计…`);
    try {
      const result = await readVerifiedArchiveRestoreAuditText(await file.text(), archiveRestoreAuditFileType(file.name, file.type));
      const value = { fileName: file.name, ...result };
      if (side === 'left') setAuditDiffLeft(value); else setAuditDiffRight(value);
      setMessage(result.report ? `${side === 'left' ? '左侧' : '右侧'}恢复差异审计已通过验证。` : `${side === 'left' ? '左侧' : '右侧'}恢复差异审计未通过验证，不能比较。`);
    } catch (error) { setMessage(`恢复差异审计读取失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const generateAuditDiff = async () => {
    if (!auditDiffLeft?.report || !auditDiffRight?.report) return;
    setBusy(true); setMessage('正在重新验证两侧恢复差异审计并生成版本对比…');
    try { setAuditDiff(await createArchiveRestoreAuditDiff(auditDiffLeft.report, auditDiffRight.report)); setMessage('恢复差异审计版本对比已生成；没有恢复或写入任何工程数据。'); }
    catch (error) { setAuditDiff(undefined); setMessage(`恢复差异版本对比失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const downloadAuditDiff = async (kind: 'json' | 'html') => {
    if (!auditDiff || !auditDiffLeft?.report || !auditDiffRight?.report) return;
    setBusy(true); setMessage('正在重新验证两侧审计后准备下载…');
    try {
      const refreshed = await createArchiveRestoreAuditDiff(auditDiffLeft.report, auditDiffRight.report, new Date(auditDiff.generatedAt));
      if (refreshed.manifest.comparisonSha256 !== auditDiff.manifest.comparisonSha256) throw new Error('两侧审计在比较后发生变化，请重新生成。');
      const filename = `${safeName(refreshed.left.archiveId)}-${refreshed.id.slice(-8)}.restore-audit-diff.${kind}`;
      if (kind === 'json') downloadJson(refreshed, filename); else downloadText(archiveRestoreAuditDiffToHtml(refreshed), filename, 'text/html');
      setMessage('两侧审计重新验证通过，版本对比文件已生成。');
    } catch (error) { setAuditDiff(undefined); setMessage(`版本对比下载失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const verifyAuditDiff = async (file?: File) => {
    if (!file) return;
    setBusy(true); setAuditDiffVerification(undefined); setMessage('正在以只读方式复算恢复审计版本对比哈希…');
    try {
      const result = await verifyArchiveRestoreAuditDiffText(await file.text(), archiveRestoreAuditDiffFileType(file.name, file.type));
      setAuditDiffVerification(result);
      setMessage(result.status === 'verified' ? '恢复审计版本对比五个数据段与整份哈希全部通过。' : result.status === 'unsupported' ? '恢复审计版本对比格式、版本或字段不受支持；没有导入任何内容。' : `恢复审计版本对比验证失败：${result.errors.length} 个问题。`);
    } catch (error) { setMessage(`恢复审计版本对比验证失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const hasPendingRelocation = Object.keys(relocationReviews).some((sourceId) => !relocations[sourceId]);
  const setDomain = (key: keyof ArchiveDisclosureSelection, value: boolean) => { setDisclosure((current) => ({ ...current, [key]: value })); setExportPlan(undefined); setDependencyAccepted(false); };

  return <section aria-label="工程归档与可移植恢复包" className="space-y-2 border-t border-stroke pt-3 text-[10px] text-ink-dim">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between text-left font-semibold text-ink">
      <span>工程归档与可移植恢复包</span><span>{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="space-y-2">
      <p>默认生成满足工程恢复的最小披露归档。可选证据域会先计算依赖闭包；长视频只保存路径、大小与可用哈希，不复制原片。</p>
      <fieldset className="space-y-1 rounded border border-stroke p-2" aria-label="归档披露范围">
        <legend className="px-1 font-semibold text-ink">可选证据域</legend>
        <label className="block"><input type="checkbox" checked={disclosure.publicationEvidence} onChange={(event) => setDomain('publicationEvidence', event.target.checked)} /> 发布观察与实验</label>
        <label className="block"><input type="checkbox" checked={disclosure.directorLearning} onChange={(event) => setDomain('directorLearning', event.target.checked)} /> 跨项目导演学习</label>
        <label className="block"><input type="checkbox" checked={disclosure.batchAudit} onChange={(event) => setDomain('batchAudit', event.target.checked)} /> 批次会话与回滚回执</label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void previewExport()} className="rounded bg-sky-600 px-2 py-1.5 text-white disabled:opacity-40">预览归档内容</button>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="rounded border border-stroke px-2 py-1.5 disabled:opacity-40">读取恢复包</button>
        <input ref={inputRef} aria-label="选择工程恢复包" type="file" accept="application/json,.json,.hfarchive.json" className="hidden" onChange={(event) => { void importArchive(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
      {exportPlan && <article aria-label="归档内容与依赖预览" className="space-y-1 rounded border border-sky-300/25 bg-panel/60 p-2">
        <p className="font-semibold text-sky-100">{exportPlan.policy.mode === 'minimal' ? '最小披露' : exportPlan.policy.mode === 'full' ? '全量披露' : '自定义披露'} · 只读预览</p>
        <p>将包含：RC {exportPlan.policy.included.releaseCandidates} · 发布观察 {exportPlan.policy.included.postPublishObservations} · 实验 {exportPlan.policy.included.postPublishExperiments} · 学习 {exportPlan.policy.included.directorLearning} · 批次 {exportPlan.policy.included.postPublishBatchSessions} · 回滚 {exportPlan.policy.included.postPublishBatchRollbacks}</p>
        <p>主动排除：{exportPlan.policy.omittedDomains.join('、') || '无'}</p>
        {exportPlan.policy.sensitiveSummaries.map((item) => <p key={item} className="text-amber-100">将披露：{item}</p>)}
        {exportPlan.requiresDependencyAcceptance && <><p>依赖闭包额外加入：RC {exportPlan.policy.dependencyClosureAdded.releaseCandidates} · 发布观察 {exportPlan.policy.dependencyClosureAdded.postPublishObservations} · 实验 {exportPlan.policy.dependencyClosureAdded.postPublishExperiments}</p><label className="block"><input aria-label="接受归档依赖闭包" type="checkbox" checked={dependencyAccepted} onChange={(event) => setDependencyAccepted(event.target.checked)} /> 我已检查并接受为保持证据可核验而自动加入的依赖</label></>}
        {exportPlan.blockers.map((item) => <p key={item} className="text-red-200">阻断：{item}</p>)}
        <button type="button" disabled={busy || exportPlan.blockers.length > 0 || (exportPlan.requiresDependencyAcceptance && !dependencyAccepted)} onClick={() => void exportArchive()} className="rounded bg-emerald-600 px-2 py-1.5 text-white disabled:opacity-40">导出已预览归档</button>
      </article>}
      <p>本机保存：{savedCounts.archives} 个导入归档 · {savedCounts.checkpoints} 个切换前检查点</p>
      <div className="space-y-1 rounded border border-stroke p-2" aria-label="恢复差异审计独立验证器">
        <p className="font-semibold text-sky-100">独立验证恢复差异审计</p>
        <p>只读取 JSON 或 HTML 文本并复算哈希；不会执行脚本、恢复工程、保存检查点或写入本机记录。</p>
        <button type="button" disabled={busy} onClick={() => auditVerificationInput.current?.click()} className="rounded border border-sky-300/30 px-2 py-1 disabled:opacity-40">选择恢复差异审计验证</button>
        <input ref={auditVerificationInput} aria-label="选择恢复差异审计验证文件" type="file" accept="application/json,text/html,.json,.html,.htm" className="hidden" onChange={(event) => { void verifyRestoreAudit(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
      {auditVerification && <article aria-label="恢复差异审计验证结果" className="space-y-1 rounded border border-stroke bg-panel/60 p-2">
        <p className={auditVerification.status === 'verified' ? 'text-emerald-200' : auditVerification.status === 'unsupported' ? 'text-amber-100' : 'text-red-200'}>验证状态：{auditVerification.status === 'verified' ? '全部通过' : auditVerification.status === 'unsupported' ? '格式或字段不受支持' : '验证失败'}</p>
        <p>文件类型：{auditVerification.fileType.toUpperCase()} · 格式：{auditVerification.format ?? '缺失'} · 版本：{auditVerification.version ?? '缺失'}</p>
        <p>归档：{auditVerification.archiveId ?? '缺失'} · v{auditVerification.archiveVersion ?? '缺失'} · 披露模式 {auditVerification.disclosureMode ?? '缺失'}</p>
        <p>比较时间：{auditVerification.comparedAt ?? '缺失'}</p>
        {auditVerification.sections.map((section) => <p key={section.name} className={section.status === 'verified' ? 'text-emerald-200' : 'text-red-200'}>{section.name}：{section.status === 'verified' ? '通过' : section.status === 'tampered' ? '篡改或不一致' : section.status === 'missing' ? '缺失' : '不支持'}</p>)}
        <p className={auditVerification.audit.status === 'verified' ? 'break-all text-emerald-200' : 'break-all text-red-200'}>整份审计：{auditVerification.audit.status === 'verified' ? '通过' : auditVerification.audit.status === 'tampered' ? '哈希不一致' : '哈希缺失'} · {auditVerification.audit.actualSha256 ?? '未计算'}</p>
        {auditVerification.unknownFields.length > 0 && <p className="text-amber-100">未知字段：{auditVerification.unknownFields.join('、')}</p>}
        {auditVerification.errors.map((item) => <p key={item} className="text-red-200">问题：{item}</p>)}
      </article>}
      <div className="space-y-1 rounded border border-stroke p-2" aria-label="恢复差异审计版本对比">
        <p className="font-semibold text-sky-100">两份已验证恢复差异审计对比</p>
        <p>只陈述记录、省略、容量、素材及阻断/警告的结构变化，不恢复工程，也不判断哪份方案更优。</p>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => auditDiffLeftInput.current?.click()} className="rounded border border-sky-300/30 px-2 py-1 disabled:opacity-40">选择左侧恢复审计</button><input ref={auditDiffLeftInput} aria-label="选择左侧恢复差异审计" type="file" accept="application/json,text/html,.json,.html,.htm" className="hidden" onChange={(event) => { void readAuditDiffSide('left', event.target.files?.[0]); event.target.value = ''; }} /><button type="button" disabled={busy} onClick={() => auditDiffRightInput.current?.click()} className="rounded border border-sky-300/30 px-2 py-1 disabled:opacity-40">选择右侧恢复审计</button><input ref={auditDiffRightInput} aria-label="选择右侧恢复差异审计" type="file" accept="application/json,text/html,.json,.html,.htm" className="hidden" onChange={(event) => { void readAuditDiffSide('right', event.target.files?.[0]); event.target.value = ''; }} /><button type="button" disabled={busy || !auditDiffLeft?.report || !auditDiffRight?.report} onClick={() => void generateAuditDiff()} className="rounded bg-sky-600 px-2 py-1 text-white disabled:opacity-40">生成恢复审计版本对比</button></div>
        {([['左侧', auditDiffLeft], ['右侧', auditDiffRight]] as const).map(([label, value]) => value && <div key={label} className="rounded border border-stroke/70 p-1"><p className={value.report ? 'text-emerald-200' : 'text-red-200'}>{label}：{value.fileName} · {value.report ? '验证通过' : '验证失败'}</p>{value.report && <><p>{value.report.id} · 归档 {value.report.archive.id} v{value.report.archive.version} · {value.report.archive.disclosureMode} · {value.report.comparedAt}</p><p className="break-all">审计 SHA-256：{value.report.manifest.auditSha256}</p></>}</div>)}
      </div>
      {auditDiff && <article aria-label="恢复差异审计版本对比预览" className="space-y-1 rounded border border-sky-300/25 bg-panel/60 p-2">
        <p className="font-semibold text-sky-100">恢复差异审计版本对比 · 只读</p><p>新增 {auditDiff.summary.added} · 移除 {auditDiff.summary.removed} · 变化 {auditDiff.summary.changed} · 相同 {auditDiff.summary.identical}</p>
        {Object.values(auditDiff.sections).map((section) => <div key={section.name} className="rounded border border-stroke/70 p-1"><p>{section.label}：新增 {section.summary.added} · 移除 {section.summary.removed} · 变化 {section.summary.changed} · 相同 {section.summary.identical}</p>{section.items.filter((item) => item.status !== 'identical').map((item) => <div key={item.id} className="ml-2"><p className="break-all">{item.status} · {item.id} · 左 {item.leftSha256 ?? '无'} · 右 {item.rightSha256 ?? '无'}</p>{item.changes.map((change) => <p key={change.field} className="break-all text-ink-faint">字段 {change.field}：{JSON.stringify(change.before) ?? '无'} → {JSON.stringify(change.after) ?? '无'}</p>)}</div>)}</div>)}
        {auditDiff.warnings.map((item) => <p key={item} className="text-amber-100">提示：{item}</p>)}<p>{auditDiff.statement}</p><p className="break-all">比较 SHA-256：{auditDiff.manifest.comparisonSha256}</p>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void downloadAuditDiff('json')} className="rounded border border-sky-300/30 px-2 py-1 disabled:opacity-40">下载恢复审计对比 JSON</button><button type="button" disabled={busy} onClick={() => void downloadAuditDiff('html')} className="rounded border border-sky-300/30 px-2 py-1 disabled:opacity-40">下载恢复审计对比 HTML</button></div>
      </article>}
      <div className="space-y-1 rounded border border-stroke p-2" aria-label="恢复差异审计版本对比独立验证器">
        <p className="font-semibold text-sky-100">独立验证恢复审计版本对比</p>
        <p>只读取 JSON 或 HTML 文本并复算五个数据段与整份哈希；不会执行脚本、恢复工程或写入本机记录。</p>
        <button type="button" disabled={busy} onClick={() => auditDiffVerificationInput.current?.click()} className="rounded border border-sky-300/30 px-2 py-1 disabled:opacity-40">选择恢复审计对比验证</button>
        <input ref={auditDiffVerificationInput} aria-label="选择恢复审计版本对比验证文件" type="file" accept="application/json,text/html,.json,.html,.htm" className="hidden" onChange={(event) => { void verifyAuditDiff(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
      {auditDiffVerification && <article aria-label="恢复差异审计版本对比验证结果" className="space-y-1 rounded border border-stroke bg-panel/60 p-2">
        <p className={auditDiffVerification.status === 'verified' ? 'text-emerald-200' : auditDiffVerification.status === 'unsupported' ? 'text-amber-100' : 'text-red-200'}>验证状态：{auditDiffVerification.status === 'verified' ? '全部通过' : auditDiffVerification.status === 'unsupported' ? '格式或字段不受支持' : '验证失败'}</p>
        <p>文件类型：{auditDiffVerification.fileType.toUpperCase()} · 格式：{auditDiffVerification.format ?? '缺失'} · 版本：{auditDiffVerification.version ?? '缺失'} · 生成时间：{auditDiffVerification.generatedAt ?? '缺失'}</p>
        <p>左侧：{auditDiffVerification.left?.id ?? '缺失'} · 归档 {auditDiffVerification.left?.archiveId ?? '缺失'} v{auditDiffVerification.left?.archiveVersion ?? '缺失'} · {auditDiffVerification.left?.disclosureMode ?? '缺失'}</p>
        <p>右侧：{auditDiffVerification.right?.id ?? '缺失'} · 归档 {auditDiffVerification.right?.archiveId ?? '缺失'} v{auditDiffVerification.right?.archiveVersion ?? '缺失'} · {auditDiffVerification.right?.disclosureMode ?? '缺失'}</p>
        <p>归档匹配：ID {auditDiffVerification.archiveMatch?.id === true ? '是' : auditDiffVerification.archiveMatch?.id === false ? '否' : '缺失'} · 版本 {auditDiffVerification.archiveMatch?.version === true ? '是' : auditDiffVerification.archiveMatch?.version === false ? '否' : '缺失'} · 披露模式 {auditDiffVerification.archiveMatch?.disclosureMode === true ? '是' : auditDiffVerification.archiveMatch?.disclosureMode === false ? '否' : '缺失'}</p>
        {auditDiffVerification.sections.map((section) => <p key={section.name} className={section.status === 'verified' ? 'text-emerald-200' : 'text-red-200'}>{section.name}：{section.status === 'verified' ? '通过' : section.status === 'tampered' ? '篡改或不一致' : section.status === 'missing' ? '缺失' : '不支持'}</p>)}
        <p className={auditDiffVerification.comparison.status === 'verified' ? 'break-all text-emerald-200' : 'break-all text-red-200'}>整份对比：{auditDiffVerification.comparison.status === 'verified' ? '通过' : auditDiffVerification.comparison.status === 'tampered' ? '哈希不一致' : '哈希缺失'} · {auditDiffVerification.comparison.actualSha256 ?? '未计算'}</p>
        {auditDiffVerification.unknownFields.length > 0 && <p className="text-amber-100">未知字段：{auditDiffVerification.unknownFields.join('、')}</p>}
        {auditDiffVerification.errors.map((item) => <p key={item} className="text-red-200">问题：{item}</p>)}
      </article>}
      {preview && <article aria-label="工程归档恢复预览" className="space-y-2 rounded border border-stroke bg-panel/60 p-2">
        <p className={preview.integrity === 'verified' ? 'text-emerald-200' : 'text-red-200'}>完整性：{preview.integrity === 'verified' ? '全部数据段 SHA-256 通过' : '校验失败'}</p>
        <p>归档：{preview.archive.projectName} · v{preview.archive.version} · {new Date(preview.archive.createdAt).toLocaleString()}</p>
        <p>将打开为：{preview.restoredProjectName}</p>
        <p>RC {preview.counts.releaseCandidates} · 发布观察 {preview.counts.postPublishObservations} · 批次会话 {preview.counts.postPublishBatchSessions} · 回滚回执 {preview.counts.postPublishBatchRollbacks} · 实验 {preview.counts.postPublishExperiments} · 学习 {preview.counts.directorLearning}</p>
        <button type="button" disabled={busy || preview.integrity !== 'verified'} onClick={() => void generateRestoreAudit()} className="rounded border border-sky-300/30 px-2 py-1.5 text-sky-100 disabled:opacity-40">生成只读恢复差异审计</button>
        {restoreAudit && <article aria-label="归档恢复差异审计预览" className="space-y-1 rounded border border-sky-300/25 bg-panel-2 p-2">
          <p className="font-semibold text-sky-100">恢复差异审计 · {restoreAudit.archive.disclosureMode === 'legacy-full' ? '旧版全量披露' : restoreAudit.archive.disclosureMode}</p>
          <p>新增 {restoreAudit.summary.newRecords} · 相同 {restoreAudit.summary.identicalRecords} · 同 ID 冲突 {restoreAudit.summary.conflicts} · 主动省略 {restoreAudit.summary.intentionallyOmittedRecords} · 容量风险 {restoreAudit.summary.capacityRisks}</p>
          {restoreAudit.sections.collections.map((item) => <p key={item.name}>{item.label}：新增 {item.newCount} / 相同 {item.identicalCount} / 冲突 {item.conflictCount} · 合并 {item.merged}/{item.limit}{item.capacityStatus === 'over-limit' ? '（超限）' : ''}</p>)}
          <p>素材：可用已核验 {restoreAudit.summary.sourceStatuses.verified} · 可用未核验 {restoreAudit.summary.sourceStatuses['available-unverified']} · 离线 {restoreAudit.summary.sourceStatuses.missing} · 错版 {restoreAudit.summary.sourceStatuses.changed} · 待确认重定位 {restoreAudit.summary.sourceStatuses['pending-relocation']}</p>
          <p>v3 主动省略：{restoreAudit.sections.disclosureDomains.join('、') || '无'}</p>
          {restoreAudit.sections.findings.warnings.map((item) => <p key={`audit-warning-${item}`} className="text-amber-100">提示：{item}</p>)}
          {restoreAudit.sections.findings.blockers.map((item) => <p key={`audit-blocker-${item}`} className="text-red-200">阻断：{item}</p>)}
          <p className="break-all">整体 SHA-256：{restoreAudit.manifest.auditSha256}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => downloadJson(restoreAudit, `${safeName(restoreAudit.archive.projectName)}-restore-diff-audit.json`)} className="rounded bg-sky-600 px-2 py-1 text-white">下载差异审计 JSON</button>
            <button type="button" onClick={() => downloadText(archiveRestoreAuditToHtml(restoreAudit), `${safeName(restoreAudit.archive.projectName)}-restore-diff-audit.html`, 'text/html')} className="rounded bg-sky-600 px-2 py-1 text-white">下载差异审计 HTML</button>
          </div>
        </article>}
        <div className="max-h-72 space-y-2 overflow-auto rounded border border-stroke p-2">
          {preview.sourceResults.length === 0 ? <p>归档没有外部长视频引用。</p> : preview.sourceResults.map((source) => {
            const review = relocationReviews[source.id];
            const mapping = relocations[source.id];
            return <div key={source.id} className="space-y-1 rounded border border-stroke/70 p-2">
              <p className="break-all"><span className={source.restoreStatus === 'missing' ? 'text-amber-100' : source.restoreStatus === 'changed' ? 'text-red-200' : 'text-emerald-200'}>{statusLabel[source.restoreStatus]}</span> · {source.name} · {source.expectedSize} bytes · {source.duration.toFixed(3)}s · {source.path}</p>
              {source.restoreStatus === 'missing' && <button type="button" disabled={busy} onClick={() => void chooseRelocation(source.id)} className="rounded border border-sky-300/30 px-2 py-1 text-sky-100 disabled:opacity-40">{review ? '重新选择候选文件' : '选择候选文件'}</button>}
              {review && <div aria-label={`原片重定位核对 ${source.name}`} className="space-y-1 rounded bg-panel-2 p-2">
                <p className="break-all text-sky-100">候选：{review.candidate.path}</p>
                <p>文件大小：归档 {source.expectedSize} bytes / 候选 {review.candidate.size} bytes · {review.comparison.size === 'match' ? '一致' : '不一致'}</p>
                <p>视频时长：归档 {source.duration.toFixed(3)}s / 候选 {review.candidate.duration.toFixed(3)}s · {review.comparison.duration === 'match' ? '一致' : '不一致'}</p>
                <p>快速哈希：{review.comparison.quickSha256 === 'match' ? '一致' : review.comparison.quickSha256 === 'mismatch' ? '不一致' : '归档凭证不足，未比较'}</p>
                {review.warnings.map((item) => <p key={item} className="text-amber-100">提示：{item}</p>)}
                {review.blockers.map((item) => <p key={item} className="text-red-200">阻断：{item}</p>)}
                {!mapping && review.blockers.length === 0 && <><label className="block"><input aria-label={`确认重定位 ${source.name}`} type="checkbox" checked={Boolean(relocationConfirmations[source.id])} onChange={(event) => { setRelocationConfirmations((current) => ({ ...current, [source.id]: event.target.checked })); setConfirmed(false); }} /> 我已人工确认候选文件对应这条归档原片</label><button type="button" onClick={() => confirmRelocation(source.id)} className="rounded bg-sky-600 px-2 py-1 text-white">建立副本路径映射</button></>}
                {mapping && <p className="text-emerald-200">已确认映射 · {new Date(mapping.confirmedAt).toLocaleString()} · 只应用到恢复副本</p>}
              </div>}
            </div>;
          })}
        </div>
        {preview.warnings.map((item) => <p key={item} className="text-amber-100">提示：{item}</p>)}
        {preview.blockers.map((item) => <p key={item} className="text-red-200">阻断：{item}</p>)}
        <p>归档原件中的绝对路径永不改写。只有逐条核对并确认的离线原片会在恢复副本中使用新路径；未确认或错版素材继续保留原路径并标记缺失。</p>
        {hasPendingRelocation && <p className="text-amber-100">存在已选择但尚未确认的候选文件；请确认映射或重新读取恢复包后再恢复。</p>}
        <label className="block"><input aria-label="确认恢复为独立副本" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> 我已检查完整性、原片状态和冲突；先保存当前工程检查点，再打开恢复副本</label>
        <button type="button" disabled={busy || !confirmed || preview.blockers.length > 0 || hasPendingRelocation} onClick={() => void restore()} className="rounded bg-emerald-600 px-2 py-1.5 text-white disabled:opacity-40">恢复为新工程副本</button>
      </article>}
      {message && <p role="status" className="text-sky-100">{message}</p>}
    </div>}
  </section>;
}
