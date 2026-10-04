import { useEffect, useMemo, useState } from 'react';
import { loadPostPublishExperiments, loadPostPublishObservations, loadReleaseCandidates, savePostPublishExperiment } from '@/lib/persistence';
import { comparePostPublishObservations, createPostPublishExperimentReview, experimentReviewIsCurrent, type PostPublishExperimentReview } from '@/lib/postPublishExperiment';
import type { PostPublishObservation } from '@/lib/postPublishFeedback';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';

function metric(value: number, unit: string) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`;
}

export default function PostPublishExperimentPanel() {
  const [expanded, setExpanded] = useState(false);
  const [observations, setObservations] = useState<PostPublishObservation[]>([]);
  const [candidates, setCandidates] = useState<ReleaseCandidate[]>([]);
  const [reviews, setReviews] = useState<PostPublishExperimentReview[]>([]);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([loadPostPublishObservations(), loadReleaseCandidates(), loadPostPublishExperiments()]).then(([observationItems, candidateItems, reviewItems]) => {
      if (!active) return;
      setObservations(observationItems); setCandidates(candidateItems); setReviews(reviewItems);
      setLeftId(observationItems[0]?.id ?? ''); setRightId(observationItems[1]?.id ?? '');
    }).catch(() => active && setMessage('发布实验记录读取失败。'));
    return () => { active = false; };
  }, []);

  const left = observations.find((item) => item.id === leftId);
  const right = observations.find((item) => item.id === rightId);
  const comparison = useMemo(() => left && right ? comparePostPublishObservations(left, right, candidates) : undefined, [left, right, candidates]);
  const save = async () => {
    if (!comparison || busy) return;
    setBusy(true);
    try {
      const review = createPostPublishExperimentReview(comparison, conclusion, acknowledged, reviews);
      await savePostPublishExperiment(review);
      setReviews((current) => [review, ...current]); setConclusion(''); setAcknowledged(false);
      window.dispatchEvent(new Event('hyperframes:learning-source-updated'));
      setMessage('人工比较结论已独立保存；没有修改导演 Brief、故事选版或任何 RC。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const inputClass = 'min-w-0 rounded border border-stroke bg-panel px-2 py-1 text-[9.5px] text-ink outline-none';
  return <section aria-label="发布实验对照" className="rounded-lg border border-indigo-300/20 bg-indigo-300/[0.035] p-2.5">
    <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left">
      <span className="text-[11px] font-semibold text-indigo-100">发布实验对照</span>
      <span className="rounded-full border border-indigo-300/20 px-2 py-0.5 text-[9px] text-indigo-100">{reviews.length} 人工结论</span>
      <span className="ml-auto text-[11px] text-ink-faint">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="mt-2.5 space-y-2.5 border-t border-stroke pt-2.5 text-[9.5px] text-ink-dim">
      <p>只做描述性版本对照。平台、账号、主题、观测窗口和成片身份先通过可比性检查；发布时间、片长和样本差异会保留为限制。</p>
      {observations.length < 2 ? <p className="rounded border border-amber-300/20 p-2 text-amber-100">至少需要两条发布后观察。</p> : <div className="grid grid-cols-2 gap-1.5">
        <select aria-label="对照基线观察" className={inputClass} value={leftId} onChange={(event) => { setLeftId(event.target.value); setAcknowledged(false); }}><option value="">选择基线</option>{observations.map((item) => <option key={item.id} value={item.id}>{item.rcLabel} · {item.source.platform} · {item.windowHours}h</option>)}</select>
        <select aria-label="对照版本观察" className={inputClass} value={rightId} onChange={(event) => { setRightId(event.target.value); setAcknowledged(false); }}><option value="">选择对照</option>{observations.map((item) => <option key={item.id} value={item.id}>{item.rcLabel} · {item.source.platform} · {item.windowHours}h</option>)}</select>
      </div>}
      {comparison && <article className="space-y-2 rounded border border-stroke bg-panel/60 p-2">
        <div className="flex items-center justify-between"><span className="font-semibold">可比性检查</span><span className={`rounded px-1.5 py-0.5 ${comparison.status === 'blocked' ? 'bg-red-300/10 text-red-200' : comparison.status === 'limited' ? 'bg-amber-300/10 text-amber-100' : 'bg-emerald-300/10 text-emerald-100'}`}>{comparison.status === 'blocked' ? '不可比较' : comparison.status === 'limited' ? '有限可比' : '可比较'}</span></div>
        <div className="grid grid-cols-[0.7fr_1fr_1fr] gap-1 border-t border-stroke pt-1.5">
          <span></span><b className="font-normal text-cyan-100">{comparison.facts.left.rcLabel}</b><b className="font-normal text-indigo-100">{comparison.facts.right.rcLabel}</b>
          <span>主题</span><span>{comparison.facts.left.topic}</span><span>{comparison.facts.right.topic}</span>
          <span>平台/账号</span><span>{comparison.facts.left.platform} / {comparison.facts.left.accountLabel}</span><span>{comparison.facts.right.platform} / {comparison.facts.right.accountLabel}</span>
          <span>发布时间</span><span>{new Date(comparison.facts.left.publishedAt).toLocaleString()}</span><span>{new Date(comparison.facts.right.publishedAt).toLocaleString()}</span>
          <span>观测窗口</span><span>{comparison.facts.left.windowHours}h</span><span>{comparison.facts.right.windowHours}h</span>
          <span>成片时长</span><span>{comparison.facts.left.duration.toFixed(1)}s</span><span>{comparison.facts.right.duration.toFixed(1)}s</span>
          <span>播放样本</span><span>{comparison.facts.left.views ?? '未提供'}</span><span>{comparison.facts.right.views ?? '未提供'}</span>
          <span>故事版本</span><span>{comparison.facts.left.storyVersionId ?? '未绑定'}</span><span>{comparison.facts.right.storyVersionId ?? '未绑定'}</span>
        </div>
        {comparison.blockers.map((item) => <p key={item} className="text-red-200">阻断：{item}</p>)}
        {comparison.warnings.map((item) => <p key={item} className="text-amber-100">限制：{item}</p>)}
        {comparison.metrics.length > 0 && <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] gap-1 border-t border-stroke pt-1.5">
          <b className="font-normal">指标</b><b className="font-normal">基线</b><b className="font-normal">对照</b><b className="font-normal">描述差值</b>
          {comparison.metrics.flatMap((row) => [<span key={`${row.key}-label`}>{row.label}</span>, <span key={`${row.key}-left`}>{metric(row.left, row.unit)}</span>, <span key={`${row.key}-right`}>{metric(row.right, row.unit)}</span>, <span key={`${row.key}-delta`} className={row.delta > 0 ? 'text-emerald-200' : row.delta < 0 ? 'text-amber-100' : ''}>{row.delta > 0 ? '+' : ''}{metric(row.delta, row.unit)}</span>])}
        </div>}
        <p className="border-t border-stroke pt-1.5 text-ink-faint">差值只描述这两次发布观察，不证明由剪辑版本造成，也不自动指定赢家。</p>
        <textarea aria-label="人工版本比较结论" className={`${inputClass} w-full resize-y`} rows={2} placeholder="结合限制写下结论；避免使用“证明”“导致”等因果措辞" value={conclusion} onChange={(event) => setConclusion(event.target.value)} />
        <label className="block"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> 我确认版本身份和可比性，并理解这不是因果证明</label>
        <button type="button" disabled={busy || comparison.status === 'blocked'} onClick={() => void save()} className="rounded bg-indigo-600 px-2 py-1.5 text-white disabled:opacity-40">保存人工比较结论</button>
      </article>}
      {reviews.length > 0 && <div className="space-y-1 rounded border border-emerald-300/20 bg-emerald-300/[0.04] p-2"><p className="font-semibold text-emerald-100">已确认的描述性对照</p>{reviews.slice(0, 8).map((review) => <p key={review.id} className={experimentReviewIsCurrent(review, observations, candidates) ? '' : 'text-red-200'}>{review.comparison.facts.left.rcLabel} → {review.comparison.facts.right.rcLabel}：{review.conclusion}{experimentReviewIsCurrent(review, observations, candidates) ? '' : '（版本凭证已失配）'}</p>)}</div>}
      {message && <p role="status" className="text-indigo-100">{message}</p>}
    </div>}
  </section>;
}
