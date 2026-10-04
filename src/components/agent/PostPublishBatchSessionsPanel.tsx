import { useEffect, useMemo, useState } from 'react';
import {
  loadDirectorLearningRecords,
  loadPostPublishBatchRollbacks,
  loadPostPublishBatchSessions,
  loadPostPublishExperiments,
  loadPostPublishObservations,
  loadReleaseCandidates,
  rollbackPostPublishBatchSession,
} from '@/lib/persistence';
import { previewPostPublishBatchRollback, type PostPublishBatchRollback, type PostPublishBatchRollbackPreview, type PostPublishBatchSession } from '@/lib/postPublishBatchSession';
import type { PostPublishObservation } from '@/lib/postPublishFeedback';
import { useEditorStore } from '@/store/editorStore';

export default function PostPublishBatchSessionsPanel({ onObservationsChange }: { onObservationsChange: (observations: PostPublishObservation[]) => void }) {
  const storedApplications = useEditorStore((state) => state.director.learningApplications);
  const applications = storedApplications ?? [];
  const [sessions, setSessions] = useState<PostPublishBatchSession[]>([]);
  const [rollbacks, setRollbacks] = useState<PostPublishBatchRollback[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [preview, setPreview] = useState<PostPublishBatchRollbackPreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [nextSessions, nextRollbacks] = await Promise.all([loadPostPublishBatchSessions(), loadPostPublishBatchRollbacks()]);
    setSessions(nextSessions); setRollbacks(nextRollbacks);
    setSelectedId((current) => current || nextSessions[0]?.id || '');
  };
  useEffect(() => {
    void refresh().catch(() => setMessage('批次会话读取失败。'));
    const listener = () => { void refresh(); };
    window.addEventListener('hyperframes:batch-session-updated', listener);
    return () => window.removeEventListener('hyperframes:batch-session-updated', listener);
  }, []);
  const selected = sessions.find((item) => item.id === selectedId) ?? sessions[0];
  const rolledBack = useMemo(() => new Set(rollbacks.map((item) => item.sessionId)), [rollbacks]);

  const inspect = async () => {
    if (!selected || busy) return;
    setBusy(true); setConfirmed(false); setPreview(undefined);
    try {
      const [currentSessions, currentRollbacks, observations, experiments, learning, candidates] = await Promise.all([
        loadPostPublishBatchSessions(), loadPostPublishBatchRollbacks(), loadPostPublishObservations(), loadPostPublishExperiments(), loadDirectorLearningRecords(), loadReleaseCandidates(),
      ]);
      const current = currentSessions.find((item) => item.id === selected.id);
      if (!current) throw new Error('批次会话已不存在。');
      const frozenApplications = candidates.flatMap((item) => item.snapshot.director?.learningApplications ?? []);
      const next = previewPostPublishBatchRollback(current, currentSessions, currentRollbacks, observations, experiments, learning, [...applications, ...frozenApplications]);
      setSessions(currentSessions); setRollbacks(currentRollbacks); setPreview(next);
      setMessage(next.status === 'ready' ? '影响清单已刷新；该批次当前可以整体撤销。' : '影响清单已刷新；该批次当前不可撤销。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const rollback = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const result = await rollbackPostPublishBatchSession(preview.session.id, applications, confirmed, reason);
      onObservationsChange(result.observations);
      setPreview(undefined); setConfirmed(false); setReason('');
      await refresh();
      setMessage(`已整体撤销 ${result.rollback.observationIds.length} 条观察；原批次会话和回滚回执永久保留。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  if (!sessions.length) return null;
  const inputClass = 'w-full rounded border border-stroke bg-panel px-2 py-1 text-[9.5px] text-ink outline-none';
  return <section aria-label="发布批次导入会话" className="space-y-2 rounded border border-violet-300/20 bg-violet-300/[0.03] p-2">
    <div className="flex items-center gap-2"><p className="font-semibold text-violet-100">批次导入会话与受控回滚</p><span className="text-ink-faint">{sessions.length} 会话 · {rollbacks.length} 已回滚</span></div>
    <select aria-label="批次导入会话" className={inputClass} value={selected?.id ?? ''} onChange={(event) => { setSelectedId(event.target.value); setPreview(undefined); setConfirmed(false); }}>
      {sessions.map((item) => <option key={item.id} value={item.id}>{item.sourceFileName} · {item.rows.length} 行 · {rolledBack.has(item.id) ? '已回滚' : new Date(item.createdAt).toLocaleString()}</option>)}
    </select>
    {selected && <div className="space-y-1 break-all text-ink-faint">
      <p>文件 SHA-256 {selected.sourceFileSha256}</p>
      <p>模板 {selected.template.name} · {selected.template.id} · {selected.template.platform}/{selected.template.accountLabel}</p>
      <p>确认时间 {new Date(selected.confirmedAt).toLocaleString()} · 观察 {selected.rows.map((item) => item.observationId).join('、')}</p>
      <button type="button" disabled={busy} onClick={() => void inspect()} className="rounded border border-violet-300/30 px-2 py-1 text-violet-100 disabled:opacity-40">检查整批回滚影响</button>
    </div>}
    {preview && <div aria-label="批次回滚影响清单" className="space-y-1 rounded border border-stroke p-2">
      <p className="font-semibold text-ink">影响清单 · 删除 {preview.impact.observationIds.length} 条观察 · 状态 {preview.status === 'ready' ? '可整体撤销' : preview.status === 'rolled-back' ? '已经撤销' : '已阻断'}</p>
      {preview.session.rows.map((row) => <p key={row.observationId}>文件第 {row.rowIndex + 2} 行 · {row.contentId} · RC {row.rcId} · SHA-256 {row.renderSha256}</p>)}
      <p>后续引用：采纳洞察 {preview.impact.acceptedInsights.length} · 实验 {preview.impact.experimentIds.length} · 学习 {preview.impact.learningRecordIds.length} · Brief {preview.impact.briefProposalIds.length}</p>
      {preview.blockers.map((item) => <p key={item} className="text-red-200">阻断：{item}</p>)}
      {preview.status === 'ready' && <>
        <input aria-label="批次回滚原因" className={inputClass} placeholder="为什么需要整体撤销？" value={reason} onChange={(event) => setReason(event.target.value)} />
        <label className="block"><input aria-label="确认整体撤销批次" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> 我已检查全部行和后续引用，同意整体撤销且不保留部分观察</label>
        <button type="button" disabled={busy || !confirmed || !reason.trim()} onClick={() => void rollback()} className="rounded bg-red-700 px-2 py-1 text-white disabled:opacity-40">整体撤销 {preview.impact.observationIds.length} 条观察</button>
      </>}
    </div>}
    {message && <p role="status" className="text-violet-100">{message}</p>}
  </section>;
}
