import { useEffect, useMemo, useState } from 'react';
import { loadDirectorLearningRecords, loadPostPublishExperiments, loadPostPublishObservations, loadReleaseCandidates, saveDirectorLearningRecords } from '@/lib/persistence';
import { curateDirectorLearningRecord, directorLearningViews, filterDirectorLearningViews, groupDirectorLearningHypotheses, synchronizeDirectorLearningRecords, type DirectorLearningRecord, type LearningEvidenceRole } from '@/lib/directorLearningLibrary';
import { applyLearningBriefProposal, createLearningBriefProposal, type LearningBriefField, type LearningBriefProposal } from '@/lib/learningBriefProposal';
import type { PostPublishObservation } from '@/lib/postPublishFeedback';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';
import { useEditorStore } from '@/store/editorStore';
import type { DirectorDecision } from '@/types';

const freshnessLabel = { fresh: '新鲜 ≤60天', aging: '衰减 61–180天', expired: '过期 >180天' };
const roleLabel = { unclassified: '未整理', support: '支持', counterexample: '反例', context: '仅供参考' };
const fieldLabel: Record<LearningBriefField, string> = { objective: '传播目标', audience: '核心受众', thesis: '核心表达', contentType: '内容类型', tone: '语气', pacing: '节奏', emotionArc: '情绪弧线', endingAction: '结尾行动', visualRules: '视觉原则' };

export default function DirectorLearningLibraryPanel() {
  const director = useEditorStore((state) => state.director);
  const updateDirector = useEditorStore((state) => state.updateDirector);
  const [expanded, setExpanded] = useState(false);
  const [records, setRecords] = useState<DirectorLearningRecord[]>([]);
  const [observations, setObservations] = useState<PostPublishObservation[]>([]);
  const [candidates, setCandidates] = useState<ReleaseCandidate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('');
  const [contentType, setContentType] = useState('');
  const [freshness, setFreshness] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [curationRole, setCurationRole] = useState<Exclude<LearningEvidenceRole, 'unclassified'>>('context');
  const [hypothesis, setHypothesis] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [briefEvidenceIds, setBriefEvidenceIds] = useState<string[]>([]);
  const [proposal, setProposal] = useState<LearningBriefProposal>();
  const [proposalValues, setProposalValues] = useState<Partial<Pick<DirectorDecision, LearningBriefField>>>({});
  const [proposalFields, setProposalFields] = useState<LearningBriefField[]>([]);
  const [applicationRationale, setApplicationRationale] = useState('');
  const [confirmedEvidence, setConfirmedEvidence] = useState(false);
  const [acknowledgedExpired, setAcknowledgedExpired] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => void Promise.all([loadPostPublishObservations(), loadPostPublishExperiments(), loadReleaseCandidates(), loadDirectorLearningRecords()])
      .then(async ([observationItems, experimentItems, candidateItems, stored]) => {
        if (!active) return;
        const synced = synchronizeDirectorLearningRecords(observationItems, experimentItems, candidateItems, stored);
        if (synced.length > stored.length) await saveDirectorLearningRecords(synced);
        if (!active) return;
        setObservations(observationItems); setCandidates(candidateItems); setRecords(synced); setSelectedId(synced[0]?.id ?? '');
      }).catch(() => active && setMessage('导演学习库读取失败。'));
    refresh();
    window.addEventListener('hyperframes:learning-source-updated', refresh);
    return () => { active = false; window.removeEventListener('hyperframes:learning-source-updated', refresh); };
  }, []);

  const views = useMemo(() => directorLearningViews(records, observations, candidates), [records, observations, candidates]);
  const filtered = useMemo(() => filterDirectorLearningViews(views, { query, platform, contentType, freshness, role: roleFilter }), [views, query, platform, contentType, freshness, roleFilter]);
  const selected = views.find((item) => item.id === selectedId) ?? filtered[0];
  const hypotheses = useMemo(() => groupDirectorLearningHypotheses(records), [records]);
  const platforms = [...new Set(records.flatMap((item) => item.scope.platforms))];
  const contentTypes = [...new Set(records.flatMap((item) => item.scope.contentTypes))];

  useEffect(() => {
    if (!selected) return;
    setCurationRole(selected.curation?.role ?? 'context'); setHypothesis(selected.curation?.hypothesis ?? ''); setNote(selected.curation?.note ?? ''); setConfirmed(false);
  }, [selected?.id]);

  const curate = async () => {
    if (!selected) return;
    try {
      const updated = curateDirectorLearningRecord(selected, curationRole, hypothesis, note, confirmed);
      await saveDirectorLearningRecords([updated]);
      setRecords((current) => current.map((item) => item.id === updated.id ? updated : item)); setConfirmed(false);
      setMessage('学习记录已分类；它仍只是可检索参考，不会自动进入任何工程。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const toggleBriefEvidence = (id: string) => {
    setBriefEvidenceIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setProposal(undefined); setConfirmedEvidence(false); setAcknowledgedExpired(false);
  };
  const generateBriefProposal = () => {
    const next = createLearningBriefProposal(views, briefEvidenceIds, director);
    setProposal(next); setProposalValues({ ...next.suggested }); setProposalFields([]);
    setApplicationRationale(''); setConfirmedEvidence(false); setAcknowledgedExpired(false);
    setMessage(next.blockers.length ? '建议已生成，但必须先解决阻断项。' : '建议已生成。请逐条检查引用，再勾选要应用的 Brief 字段。');
  };
  const applyBriefProposal = () => {
    if (!proposal) return;
    try {
      const currentViews = directorLearningViews(records, observations, candidates);
      const patch = applyLearningBriefProposal(proposal, currentViews, director, proposalValues, proposalFields, { confirmedEvidence, acknowledgedExpired, rationale: applicationRationale });
      updateDirector(patch);
      setMessage('已作为一次可撤销的导演更新应用；可用全局撤销恢复。');
      setProposal(undefined); setBriefEvidenceIds([]); setProposalFields([]);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const inputClass = 'min-w-0 rounded border border-stroke bg-panel px-2 py-1 text-[9.5px] text-ink outline-none';
  const counts = { fresh: views.filter((item) => item.freshness === 'fresh').length, aging: views.filter((item) => item.freshness === 'aging').length, expired: views.filter((item) => item.freshness === 'expired').length, counterexamples: records.filter((item) => item.curation?.role === 'counterexample').length };
  return <section aria-label="跨项目导演学习库" className="rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/[0.035] p-2.5">
    <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left">
      <span className="text-[11px] font-semibold text-fuchsia-100">跨项目导演学习库</span>
      <span className="rounded-full border border-fuchsia-300/20 px-2 py-0.5 text-[9px] text-fuchsia-100">{records.length} 证据 · {counts.counterexamples} 反例</span>
      <span className="ml-auto text-[11px] text-ink-faint">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="mt-2.5 space-y-2.5 border-t border-stroke pt-2.5 text-[9.5px] text-ink-dim">
      <p>收录已经人工采纳的发布洞察和人工确认的版本对照。按范围和时效检索，但不会自动写入新工程或变成永久规则。</p>
      <div className="grid grid-cols-4 gap-1 text-center"><span className="rounded bg-emerald-300/10 p-1 text-emerald-100">新鲜 {counts.fresh}</span><span className="rounded bg-amber-300/10 p-1 text-amber-100">衰减 {counts.aging}</span><span className="rounded bg-red-300/10 p-1 text-red-100">过期 {counts.expired}</span><span className="rounded bg-fuchsia-300/10 p-1 text-fuchsia-100">反例 {counts.counterexamples}</span></div>
      <div className="grid grid-cols-2 gap-1">
        <input aria-label="搜索导演学习库" className={inputClass} placeholder="搜索结论、证据、主题、边界…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="学习库平台筛选" className={inputClass} value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">全部平台</option>{platforms.map((item) => <option key={item}>{item}</option>)}</select>
        <select aria-label="学习库内容类型筛选" className={inputClass} value={contentType} onChange={(event) => setContentType(event.target.value)}><option value="">全部内容类型</option>{contentTypes.map((item) => <option key={item}>{item}</option>)}</select>
        <select aria-label="学习库时效筛选" className={inputClass} value={freshness} onChange={(event) => setFreshness(event.target.value)}><option value="">全部时效</option>{Object.entries(freshnessLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="学习库证据角色筛选" className={inputClass} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="">全部角色</option>{Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <span className="self-center text-right">匹配 {filtered.length} / {records.length}</span>
      </div>
      {hypotheses.length > 0 && <div className="space-y-1 rounded border border-stroke p-2"><p className="font-semibold text-fuchsia-100">创作假设与反例</p>{hypotheses.map((group) => <p key={group.hypothesis}>{group.hypothesis} · 支持 {group.support} · 反例 {group.counterexamples} · 参考 {group.context}</p>)}</div>}
      <div className="max-h-52 space-y-1 overflow-y-auto">{filtered.map((item) => <div key={item.id} className={`flex rounded border ${selected?.id === item.id ? 'border-fuchsia-300/40 bg-fuchsia-300/[0.06]' : 'border-stroke'}`}>
        <label className="flex shrink-0 items-start p-2" title="加入 Brief 建议的引用证据"><input aria-label={`引用证据 ${item.summary}`} type="checkbox" checked={briefEvidenceIds.includes(item.id)} onChange={() => toggleBriefEvidence(item.id)} /></label>
        <button type="button" onClick={() => setSelectedId(item.id)} className="min-w-0 flex-1 p-2 pl-0 text-left">
          <div className="flex gap-1"><span className="rounded bg-panel-3 px-1">{item.sourceKind === 'accepted-insight' ? '采纳洞察' : '版本对照'}</span><span className="rounded bg-panel-3 px-1">{freshnessLabel[item.freshness]}</span><span className="rounded bg-panel-3 px-1">{roleLabel[item.curation?.role ?? 'unclassified']}</span><span className={item.credentialStatus === 'verified' ? 'ml-auto text-emerald-200' : item.credentialStatus === 'unavailable' ? 'ml-auto text-amber-100' : 'ml-auto text-red-200'}>{item.credentialStatus === 'verified' ? '凭证可核对' : item.credentialStatus === 'unavailable' ? '来源暂不可用' : '凭证失配'}</span></div>
          <p className="mt-1">{item.summary}</p><p className="mt-0.5 truncate text-ink-faint">{[...item.scope.platforms, ...item.scope.contentTypes, ...item.scope.audiences, ...item.scope.topics].join(' · ')}</p>
        </button>
      </div>)}</div>
      <div className="flex items-center justify-between rounded border border-fuchsia-300/20 bg-fuchsia-300/[0.03] p-2">
        <span>已选 {briefEvidenceIds.length} 条作为 Brief 引用</span>
        <button type="button" onClick={generateBriefProposal} className="rounded bg-fuchsia-600 px-2 py-1.5 text-white">生成 Brief 建议</button>
      </div>
      {selected && <article className="space-y-2 rounded border border-stroke bg-panel/60 p-2">
        <p className="font-semibold text-fuchsia-100">{selected.summary}</p>
        {selected.evidence.map((item) => <p key={item}>证据：{item}</p>)}<p>人工原判断：{selected.humanReason}</p>
        <p>范围：平台 {selected.scope.platforms.join(' / ') || '未知'} · 账号 {selected.scope.accounts.join(' / ') || '未知'} · 类型 {selected.scope.contentTypes.join(' / ') || '未知'} · 受众 {selected.scope.audiences.join(' / ') || '未知'}</p>
        <p>来源：观察 {selected.provenance.observationIds.join(' / ')} · RC {selected.provenance.rcIds.join(' / ')} · SHA-256 {selected.provenance.renderSha256.join(' / ')}</p>
        <p>证据确认于 {new Date(selected.provenance.sourceConfirmedAt).toLocaleString()} · 已过去 {selected.ageDays} 天 · {freshnessLabel[selected.freshness]}</p>
        {selected.credentialStatus !== 'verified' && <p className={selected.credentialStatus === 'mismatch' ? 'text-red-200' : 'text-amber-100'}>{selected.credentialStatus === 'mismatch' ? '当前 RC 成片哈希与学习记录不一致，不能继续引用。' : '当前本机已找不到完整原观察或 RC；保留记录，但引用时必须重新取得来源。'}</p>}
        <div className="grid grid-cols-2 gap-1">
          <select aria-label="学习证据角色" className={inputClass} value={curationRole} onChange={(event) => { setCurationRole(event.target.value as Exclude<LearningEvidenceRole, 'unclassified'>); setConfirmed(false); }}><option value="support">支持假设</option><option value="counterexample">作为反例</option><option value="context">仅供参考</option></select>
          <input aria-label="创作假设" className={inputClass} placeholder="它支持或反驳什么创作假设？" value={hypothesis} onChange={(event) => { setHypothesis(event.target.value); setConfirmed(false); }} />
          <textarea aria-label="学习分类理由" className={`${inputClass} col-span-2 resize-y`} rows={2} placeholder="分类理由、适用范围和不能外推到哪里" value={note} onChange={(event) => { setNote(event.target.value); setConfirmed(false); }} />
        </div>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> 我已检查来源、适用范围和证据时效</label>
        <button type="button" onClick={() => void curate()} className="rounded bg-fuchsia-600 px-2 py-1.5 text-white">保存学习分类</button>
      </article>}
      {proposal && <article aria-label="学习证据 Brief 建议" className="space-y-2 rounded border border-violet-300/30 bg-violet-300/[0.045] p-2">
        <div className="flex items-center justify-between"><p className="font-semibold text-violet-100">可审查的 Brief 建议</p><span>{proposal.citations.length} 条引用</span></div>
        {proposal.blockers.length > 0 && <div className="rounded border border-red-300/30 bg-red-300/[0.05] p-2 text-red-100"><p className="font-semibold">阻断项</p>{proposal.blockers.map((item) => <p key={item}>· {item}</p>)}</div>}
        {proposal.warnings.length > 0 && <div className="rounded border border-amber-300/30 bg-amber-300/[0.05] p-2 text-amber-100">{proposal.warnings.map((item) => <p key={item}>· {item}</p>)}</div>}
        <div className="space-y-1">
          {proposal.citations.map((item) => <div key={item.recordId} className="rounded border border-stroke bg-panel/60 p-2">
            <p className="font-semibold text-ink">{roleLabel[item.role]} · {freshnessLabel[item.freshness]} · 凭证可核对</p>
            <p>{item.summary}</p><p>假设：{item.hypothesis}</p>
            <p>范围：平台 {item.scope.platforms.join(' / ') || '未知'} · 账号 {item.scope.accounts.join(' / ') || '未知'} · 类型 {item.scope.contentTypes.join(' / ') || '未知'} · 受众 {item.scope.audiences.join(' / ') || '未知'}</p>
            <p>观察 {item.provenance.observationIds.join(' / ')} · RC {item.provenance.rcIds.join(' / ')} · SHA-256 {item.provenance.renderSha256.join(' / ')}</p>
            <p>来源确认于 {new Date(item.provenance.sourceConfirmedAt).toLocaleString()}</p>
          </div>)}
        </div>
        {Object.entries(proposal.suggested).map(([rawField, suggestion]) => {
          const briefField = rawField as LearningBriefField;
          const current = director[briefField];
          return <div key={briefField} className="rounded border border-stroke p-2">
            <label className="flex items-center gap-1 font-semibold text-violet-100"><input aria-label={`确认更新 ${fieldLabel[briefField]}`} type="checkbox" checked={proposalFields.includes(briefField)} onChange={(event) => setProposalFields((fields) => event.target.checked ? [...fields, briefField] : fields.filter((item) => item !== briefField))} /> 更新{fieldLabel[briefField]}</label>
            <p className="mt-1 text-ink-faint">当前：{String(current) || '未填写'}</p>
            {briefField === 'contentType'
              ? <select aria-label={`${fieldLabel[briefField]}建议值`} className={`${inputClass} mt-1 w-full`} value={String(proposalValues[briefField] ?? suggestion ?? '')} onChange={(event) => setProposalValues((values) => ({ ...values, contentType: event.target.value as DirectorDecision['contentType'] }))}><option value="knowledge">知识观点</option><option value="product">商品内容</option><option value="story">故事叙事</option><option value="tutorial">操作教程</option><option value="other">其他</option></select>
              : <textarea aria-label={`${fieldLabel[briefField]}建议值`} className={`${inputClass} mt-1 w-full resize-y`} rows={2} value={String(proposalValues[briefField] ?? suggestion ?? '')} onChange={(event) => setProposalValues((values) => ({ ...values, [briefField]: event.target.value }))} />}
          </div>;
        })}
        <textarea aria-label="证据适用理由" className={`${inputClass} w-full resize-y`} rows={2} placeholder="说明为什么这些证据适用于当前工程，以及不能外推到哪里" value={applicationRationale} onChange={(event) => setApplicationRationale(event.target.value)} />
        <label className="block"><input aria-label="确认检查学习引用" type="checkbox" checked={confirmedEvidence} onChange={(event) => setConfirmedEvidence(event.target.checked)} /> 我已逐条检查支持、反例、适用范围与 RC/成片凭证</label>
        {proposal.requiresExpiredAcknowledgement && <label className="block text-amber-100"><input aria-label="确认引用过期证据" type="checkbox" checked={acknowledgedExpired} onChange={(event) => setAcknowledgedExpired(event.target.checked)} /> 我确认仍要引用超过 180 天的证据</label>}
        <button type="button" onClick={applyBriefProposal} disabled={proposal.blockers.length > 0} className="rounded bg-violet-600 px-2 py-1.5 text-white disabled:cursor-not-allowed disabled:opacity-40">应用已确认字段</button>
        <p className="text-ink-faint">不会改写未勾选字段；应用后会留下引用快照，并可作为一次编辑撤销。</p>
      </article>}
      {message && <p role="status" className="text-fuchsia-100">{message}</p>}
    </div>}
  </section>;
}
