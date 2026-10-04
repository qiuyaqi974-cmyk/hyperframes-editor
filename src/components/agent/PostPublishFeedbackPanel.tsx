import { useEffect, useMemo, useRef, useState } from 'react';
import { loadPostPublishObservations, loadReleaseCandidates, savePostPublishObservation, savePostPublishObservationBatchSession } from '@/lib/persistence';
import { createPostPublishObservation, decidePostPublishInsight, observationMatchesCandidate, type PostPublishMetrics, type PostPublishObservation, type PostPublishObservationInput } from '@/lib/postPublishFeedback';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';
import PlatformDataAdapter from './PlatformDataAdapter';
import PostPublishBatchSessionsPanel from './PostPublishBatchSessionsPanel';
import type { PostPublishBatchSessionDraft } from '@/lib/postPublishBatchSession';

function localDateTime(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function optionalNumber(value: string) {
  return value.trim() === '' ? undefined : Number(value);
}

function parseRetention(value: string) {
  if (!value.trim()) return [];
  return value.split(/[,，;；\n]/).filter(Boolean).map((part) => {
    const [second, rate, extra] = part.trim().split(/[:：]/);
    if (extra !== undefined || second === undefined || rate === undefined) throw new Error(`留存点“${part.trim()}”应写成 秒:百分比。`);
    return { second: Number(second), rate: Number(rate) };
  });
}

const categoryLabel = { hook: '开场', pacing: '节奏', thesis: '论点', cta: '行动引导', audience: '受众' };

export default function PostPublishFeedbackPanel() {
  const [expanded, setExpanded] = useState(false);
  const [candidates, setCandidates] = useState<ReleaseCandidate[]>([]);
  const [observations, setObservations] = useState<PostPublishObservation[]>([]);
  const [selectedObservationId, setSelectedObservationId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const importRef = useRef<HTMLInputElement>(null);
  const now = Date.now();
  const [form, setForm] = useState({
    rcId: '', platform: '', accountLabel: '', postUrl: '', publishedAt: localDateTime(now - 24 * 3_600_000), observedAt: localDateTime(now),
    views: '', averageWatchSeconds: '', completionRate: '', retention: '', commentTotal: '', questions: '', objections: '', positive: '', commentSummary: '',
  });

  useEffect(() => {
    let active = true;
    void Promise.all([loadReleaseCandidates(), loadPostPublishObservations()]).then(([releaseItems, feedbackItems]) => {
      if (!active) return;
      setCandidates(releaseItems);
      setObservations(feedbackItems);
      const firstRendered = releaseItems.find((item) => item.render?.sha256);
      setForm((current) => ({ ...current, rcId: current.rcId || firstRendered?.id || releaseItems[0]?.id || '' }));
      setSelectedObservationId(feedbackItems[0]?.id || '');
    }).catch(() => active && setMessage('发布后证据读取失败。'));
    return () => { active = false; };
  }, []);

  const selectedObservation = observations.find((item) => item.id === selectedObservationId) ?? observations[0];
  const selectedCandidate = candidates.find((item) => item.id === selectedObservation?.rcId);
  const accepted = useMemo(() => observations.flatMap((observation) => observation.insights.filter((item) => item.decision === 'accepted').map((item) => ({ observation, insight: item }))), [observations]);
  const renderedCandidates = candidates.filter((item) => item.render?.sha256);

  const metricsFromForm = (): PostPublishMetrics => ({
    views: optionalNumber(form.views),
    averageWatchSeconds: optionalNumber(form.averageWatchSeconds),
    completionRate: optionalNumber(form.completionRate),
    retention: parseRetention(form.retention),
    comments: {
      total: optionalNumber(form.commentTotal), questions: optionalNumber(form.questions), objections: optionalNumber(form.objections), positive: optionalNumber(form.positive), summary: form.commentSummary,
    },
  });

  const saveInput = async (input: PostPublishObservationInput) => {
    const next = createPostPublishObservation(input, candidates, new Date(), observations);
    await savePostPublishObservation(next);
    setObservations((current) => [next, ...current]);
    setSelectedObservationId(next.id);
    setMessage(`已把 ${next.rcLabel} 的 ${next.windowHours} 小时数据保存为独立证据；${next.insights.length} 条洞察等待人工判断。`);
  };

  const saveBatchInputs = async (inputs: PostPublishObservationInput[], draft: PostPublishBatchSessionDraft) => {
    const staged = [...observations];
    const base = Date.now();
    const created = inputs.map((input, index) => {
      const next = createPostPublishObservation(input, candidates, new Date(base + index), staged);
      staged.push(next);
      return next;
    });
    await savePostPublishObservationBatchSession(created, draft, new Date(base + created.length));
    setObservations((current) => [...created, ...current]);
    setSelectedObservationId(created[0]?.id ?? '');
    window.dispatchEvent(new Event('hyperframes:batch-session-updated'));
    setMessage(`已完整保存 ${created.length} 行平台观察和不可变批次会话；所有洞察仍等待人工判断。`);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveInput({
        rcId: form.rcId,
        source: { kind: 'manual-entry', platform: form.platform, accountLabel: form.accountLabel, postUrl: form.postUrl },
        publishedAt: new Date(form.publishedAt).toISOString(), observedAt: new Date(form.observedAt).toISOString(), metrics: metricsFromForm(),
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const importJson = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const raw = JSON.parse(await file.text()) as PostPublishObservationInput;
      await saveInput({ ...raw, source: { ...raw.source, kind: 'platform-export', sourceFileName: file.name } });
    } catch (error) { setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const decide = async (observation: PostPublishObservation, insightId: string, decision: 'accepted' | 'rejected') => {
    try {
      const updated = decidePostPublishInsight(observation, insightId, decision, reasons[insightId] ?? '', confirmed[insightId] ?? false);
      await savePostPublishObservation(updated);
      setObservations((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (decision === 'accepted') window.dispatchEvent(new Event('hyperframes:learning-source-updated'));
      setConfirmed((current) => ({ ...current, [insightId]: false }));
      setMessage(decision === 'accepted' ? '已采纳为下一轮导演参考；当前 Brief、冻结方案和 RC 均未修改。' : '已保留证据并记录拒绝理由。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const inputClass = 'min-w-0 rounded border border-stroke bg-panel px-2 py-1 text-[9.5px] text-ink outline-none';
  return <section aria-label="发布后导演反馈" className="rounded-lg border border-sky-300/20 bg-sky-300/[0.035] p-2.5">
    <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left">
      <span className="text-[11px] font-semibold text-sky-100">发布后证据</span>
      <span className="rounded-full border border-sky-300/20 px-2 py-0.5 text-[9px] text-sky-100">{observations.length} 观察 · {accepted.length} 已采纳</span>
      <span className="ml-auto text-[11px] text-ink-faint">{expanded ? '−' : '+'}</span>
    </button>
    {!expanded && accepted.length > 0 && <p className="mt-1.5 line-clamp-2 text-[9.5px] text-sky-100/70">下轮参考：{accepted[0].insight.statement}</p>}
    {expanded && <div className="mt-2.5 space-y-2.5 border-t border-stroke pt-2.5 text-[9.5px] text-ink-dim">
      <p>只保存聚合指标和人工摘要。每次观察必须绑定带成片哈希的 RC，并记录平台、发布内容与观测时间窗。</p>
      {renderedCandidates.length ? <div className="grid grid-cols-2 gap-1.5">
        <select aria-label="发布数据对应 RC" className={inputClass} value={form.rcId} onChange={(event) => setForm({ ...form, rcId: event.target.value })}>{renderedCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.render!.sha256.slice(0, 10)}…</option>)}</select>
        <input aria-label="发布平台" className={inputClass} placeholder="平台，如 B站" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} />
        <input aria-label="发布账号或数据源" className={inputClass} placeholder="账号/数据源标识" value={form.accountLabel} onChange={(event) => setForm({ ...form, accountLabel: event.target.value })} />
        <input aria-label="发布链接或内容 ID" className={inputClass} placeholder="发布链接或内容 ID" value={form.postUrl} onChange={(event) => setForm({ ...form, postUrl: event.target.value })} />
        <label>发布时间<input aria-label="发布时间" type="datetime-local" className={`${inputClass} mt-0.5 w-full`} value={form.publishedAt} onChange={(event) => setForm({ ...form, publishedAt: event.target.value })} /></label>
        <label>观测时间<input aria-label="观测时间" type="datetime-local" className={`${inputClass} mt-0.5 w-full`} value={form.observedAt} onChange={(event) => setForm({ ...form, observedAt: event.target.value })} /></label>
        <input aria-label="播放量" className={inputClass} type="number" min="0" placeholder="播放量" value={form.views} onChange={(event) => setForm({ ...form, views: event.target.value })} />
        <input aria-label="平均观看秒数" className={inputClass} type="number" min="0" step="0.1" placeholder="平均观看秒数" value={form.averageWatchSeconds} onChange={(event) => setForm({ ...form, averageWatchSeconds: event.target.value })} />
        <input aria-label="完播率" className={inputClass} type="number" min="0" max="100" step="0.1" placeholder="完播率 %" value={form.completionRate} onChange={(event) => setForm({ ...form, completionRate: event.target.value })} />
        <input aria-label="留存曲线" className={inputClass} placeholder="留存点：0:100, 3:72, 10:48" value={form.retention} onChange={(event) => setForm({ ...form, retention: event.target.value })} />
        <input aria-label="评论总数" className={inputClass} type="number" min="0" placeholder="评论总数" value={form.commentTotal} onChange={(event) => setForm({ ...form, commentTotal: event.target.value })} />
        <input aria-label="提问评论数" className={inputClass} type="number" min="0" placeholder="提问数" value={form.questions} onChange={(event) => setForm({ ...form, questions: event.target.value })} />
        <input aria-label="质疑评论数" className={inputClass} type="number" min="0" placeholder="质疑数" value={form.objections} onChange={(event) => setForm({ ...form, objections: event.target.value })} />
        <input aria-label="正向评论数" className={inputClass} type="number" min="0" placeholder="正向数" value={form.positive} onChange={(event) => setForm({ ...form, positive: event.target.value })} />
        <textarea aria-label="评论聚合摘要" className={`${inputClass} col-span-2 resize-y`} rows={2} placeholder="人工聚合摘要，不粘贴评论者身份信息" value={form.commentSummary} onChange={(event) => setForm({ ...form, commentSummary: event.target.value })} />
        <button type="button" disabled={busy} onClick={() => void submit()} className="rounded bg-sky-600 px-2 py-1.5 text-white disabled:opacity-40">保存观察并生成待审洞察</button>
        <button type="button" disabled={busy} onClick={() => importRef.current?.click()} className="rounded border border-stroke px-2 py-1.5 text-ink-dim disabled:opacity-40">导入标准 JSON</button>
        <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { void importJson(event.target.files?.[0]); event.target.value = ''; }} />
        <PlatformDataAdapter candidates={renderedCandidates} existingObservations={observations} onSave={saveInput} onSaveBatch={saveBatchInputs} />
      </div> : <p className="rounded border border-amber-300/20 p-2 text-amber-100">还没有带最终成片 SHA-256 的 RC。请先完成 RC 渲染，再登记发布数据。</p>}

      <PostPublishBatchSessionsPanel onObservationsChange={(next) => { setObservations(next); setSelectedObservationId(next[0]?.id ?? ''); }} />

      {observations.length > 0 && <select aria-label="发布后观察记录" className={`${inputClass} w-full`} value={selectedObservation?.id ?? ''} onChange={(event) => setSelectedObservationId(event.target.value)}>{observations.map((item) => <option key={item.id} value={item.id}>{item.rcLabel} · {item.source.platform} · {item.windowHours}h · {new Date(item.observedAt).toLocaleString()}</option>)}</select>}
      {selectedObservation && <article className="space-y-2 rounded border border-stroke bg-panel/60 p-2">
        <p className="break-all">{selectedObservation.rcLabel} · SHA-256 {selectedObservation.renderSha256} · {selectedObservation.source.platform}/{selectedObservation.source.accountLabel} · {selectedObservation.source.postUrl}</p>
        <p>发布 {new Date(selectedObservation.publishedAt).toLocaleString()} → 观测 {new Date(selectedObservation.observedAt).toLocaleString()} · 时间窗 {selectedObservation.windowHours} 小时 · 来源 {selectedObservation.source.kind === 'manual-entry' ? '人工录入' : `平台导出 ${selectedObservation.source.sourceFileName}`}</p>
        {!observationMatchesCandidate(selectedObservation, selectedCandidate) && <p className="text-red-200">RC 或成片哈希已无法匹配；该记录只保留取证，洞察不得采纳。</p>}
        {selectedObservation.insights.length === 0 && <p>数据已留档，但当前规则没有生成方向性洞察。可等待更完整时间窗后追加新观察。</p>}
        {selectedObservation.insights.map((item) => <div key={item.id} className="space-y-1 rounded border border-stroke p-2">
          <p><span className="mr-1 rounded bg-sky-300/10 px-1 text-sky-100">{categoryLabel[item.category]}</span>{item.statement}</p><p className="text-ink-faint">证据：{item.evidence}</p>
          {item.decision === 'pending' ? <>
            <input aria-label={`${item.id} 判断理由`} className={`${inputClass} w-full`} placeholder="为什么采纳或拒绝？" value={reasons[item.id] ?? ''} onChange={(event) => setReasons({ ...reasons, [item.id]: event.target.value })} />
            <label className="block"><input type="checkbox" checked={confirmed[item.id] ?? false} onChange={(event) => setConfirmed({ ...confirmed, [item.id]: event.target.checked })} /> 我已核对 RC、成片哈希、数据来源和时间窗</label>
            <div className="flex gap-2"><button type="button" disabled={!observationMatchesCandidate(selectedObservation, selectedCandidate)} onClick={() => void decide(selectedObservation, item.id, 'accepted')} className="rounded bg-sky-600 px-2 py-1 text-white disabled:opacity-40">采纳为下轮参考</button><button type="button" onClick={() => void decide(selectedObservation, item.id, 'rejected')} className="rounded border border-stroke px-2 py-1">拒绝</button></div>
          </> : <p className={item.decision === 'accepted' ? 'text-emerald-200' : 'text-ink-faint'}>{item.decision === 'accepted' ? '已采纳' : '已拒绝'} · {item.decisionReason} · {item.decidedAt && new Date(item.decidedAt).toLocaleString()}</p>}
        </div>)}
      </article>}
      {accepted.length > 0 && <div className="rounded border border-emerald-300/20 bg-emerald-300/[0.04] p-2"><p className="font-semibold text-emerald-100">下一轮导演参考（人工采纳）</p>{accepted.slice(0, 8).map(({ observation, insight }) => <p key={`${observation.id}:${insight.id}`} className="mt-1">{observation.rcLabel} · {categoryLabel[insight.category]}：{insight.statement}</p>)}</div>}
      {message && <p role="status" className="text-sky-100">{message}</p>}
    </div>}
  </section>;
}
