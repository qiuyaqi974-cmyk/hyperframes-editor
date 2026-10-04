import { useEffect, useRef, useState } from 'react';
import type { ProjectSnapshot } from '@/types';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';
import type { StoryLineageEvidence } from '@/lib/storyLineage';
import { loadPostPublishBatchRollbacks, loadPostPublishBatchSessions } from '@/lib/persistence';
import { createPublicationAuditReport, publicationAuditFileType, publicationAuditReportToHtml, readVerifiedPublicationAuditText, verifyPublicationAuditText, type PublicationAuditReport, type PublicationAuditVerification } from '@/lib/publicationAuditReport';
import { createPublicationAuditDiff, publicationAuditDiffFileType, publicationAuditDiffToHtml, verifyPublicationAuditDiffText, type PublicationAuditDiffReport, type PublicationAuditDiffVerification } from '@/lib/publicationAuditDiff';

function safeName(value: string) { return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 80) || 'hyperframes'; }
function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export default function PublicationAuditReportPanel({ snapshot, candidate, evidence }: { snapshot: ProjectSnapshot; candidate?: ReleaseCandidate; evidence: StoryLineageEvidence }) {
  const [scope, setScope] = useState<'current' | 'rc'>(candidate ? 'rc' : 'current');
  const [report, setReport] = useState<PublicationAuditReport>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [verification, setVerification] = useState<PublicationAuditVerification>();
  const verificationInput = useRef<HTMLInputElement>(null);
  const [comparisonLeft, setComparisonLeft] = useState<{ fileName: string; verification: PublicationAuditVerification; report?: PublicationAuditReport }>();
  const [comparisonRight, setComparisonRight] = useState<{ fileName: string; verification: PublicationAuditVerification; report?: PublicationAuditReport }>();
  const [comparison, setComparison] = useState<PublicationAuditDiffReport>();
  const comparisonLeftInput = useRef<HTMLInputElement>(null);
  const comparisonRightInput = useRef<HTMLInputElement>(null);
  const [diffVerification, setDiffVerification] = useState<PublicationAuditDiffVerification>();
  const diffVerificationInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setReport(undefined); setScope(candidate ? 'rc' : 'current'); }, [candidate?.id]);
  const preview = async () => {
    setBusy(true); setMessage('正在生成只读审计预览…');
    try {
      const [batchSessions, batchRollbacks] = await Promise.all([loadPostPublishBatchSessions(), loadPostPublishBatchRollbacks()]);
      const next = await createPublicationAuditReport({ snapshot, candidate: scope === 'rc' ? candidate : undefined, evidence, batchSessions, batchRollbacks });
      setReport(next); setMessage('只读预览已生成；尚未下载任何文件。');
    } catch (error) { setMessage(`预览失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const verifyFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setVerification(undefined); setMessage('正在以只读方式复算审计哈希…');
    try {
      const result = await verifyPublicationAuditText(await file.text(), publicationAuditFileType(file.name, file.type));
      setVerification(result); setMessage(result.status === 'verified' ? '审计报告全部数据段与整份哈希均通过。' : result.status === 'unsupported' ? '审计报告格式或字段不受支持；没有导入任何内容。' : `审计报告验证失败：${result.errors.length} 个问题。`);
    } catch (error) { setMessage(`验证失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const readComparisonFile = async (side: 'left' | 'right', file?: File) => {
    if (!file) return;
    setBusy(true); setComparison(undefined); setMessage(`正在验证${side === 'left' ? '左侧' : '右侧'}审计报告…`);
    try {
      const result = await readVerifiedPublicationAuditText(await file.text(), publicationAuditFileType(file.name, file.type));
      const value = { fileName: file.name, ...result };
      if (side === 'left') setComparisonLeft(value); else setComparisonRight(value);
      setMessage(result.report ? `${side === 'left' ? '左侧' : '右侧'}报告已通过验证，可以参与比较。` : `${side === 'left' ? '左侧' : '右侧'}报告未通过验证，不能参与比较。`);
    } catch (error) {
      const failed: PublicationAuditVerification = { status: 'failed', fileType: 'json', unknownFields: [], errors: [error instanceof Error ? error.message : String(error)], sections: [], evidence: { status: 'missing' } };
      if (side === 'left') setComparisonLeft({ fileName: file.name, verification: failed }); else setComparisonRight({ fileName: file.name, verification: failed });
      setMessage(`比较报告读取失败：${failed.errors[0]}`);
    } finally { setBusy(false); }
  };
  const generateComparison = async () => {
    if (!comparisonLeft?.report || !comparisonRight?.report) return;
    setBusy(true); setMessage('正在重新验证两侧报告并生成只读差异…');
    try {
      const next = await createPublicationAuditDiff(comparisonLeft.report, comparisonRight.report);
      setComparison(next); setMessage('版本差异已生成；没有修改报告、工程或本机证据。');
    } catch (error) { setComparison(undefined); setMessage(`版本比较失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const downloadComparison = async (kind: 'json' | 'html') => {
    if (!comparison || !comparisonLeft?.report || !comparisonRight?.report) return;
    setBusy(true); setMessage('正在重新验证两侧报告后准备下载…');
    try {
      const refreshed = await createPublicationAuditDiff(comparisonLeft.report, comparisonRight.report, new Date(comparison.generatedAt));
      if (refreshed.manifest.comparisonSha256 !== comparison.manifest.comparisonSha256) throw new Error('报告在比较后发生变化，请重新生成差异。');
      const name = `${safeName(snapshot.projectName)}-${refreshed.id.slice(-8)}.audit-diff.${kind}`;
      download(kind === 'json' ? `${JSON.stringify(refreshed, null, 2)}\n` : publicationAuditDiffToHtml(refreshed), kind === 'json' ? 'application/json' : 'text/html;charset=utf-8', name);
      setMessage('两侧报告重新验证通过，差异文件已生成。');
    } catch (error) { setComparison(undefined); setMessage(`差异下载失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const verifyDiffFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setDiffVerification(undefined); setMessage('正在以只读方式复算版本差异哈希…');
    try {
      const result = await verifyPublicationAuditDiffText(await file.text(), publicationAuditDiffFileType(file.name, file.type));
      setDiffVerification(result);
      setMessage(result.status === 'verified' ? '版本差异五个数据段与整份哈希全部通过。' : result.status === 'unsupported' ? '版本差异格式、版本或字段不受支持；没有导入任何内容。' : `版本差异验证失败：${result.errors.length} 个问题。`);
    } catch (error) { setMessage(`版本差异验证失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const prefix = report ? `${safeName(snapshot.projectName)}-${report.id.slice(-8)}` : 'publication-audit';
  return <details className="rounded border border-cyan-300/25 bg-panel/60 p-2" aria-label="发布证据审计报告">
    <summary className="cursor-pointer text-[11px] font-semibold text-cyan-100">发布证据审计报告</summary>
    <p className="my-2 text-[9px] text-ink-faint">先生成只读预览，再由你明确下载 JSON 或离线 HTML。只含结构化证据摘要、关系、人工结论和已有哈希。</p>
    <div className="flex flex-wrap gap-2 text-[10px]"><button type="button" aria-pressed={scope === 'current'} onClick={() => { setScope('current'); setReport(undefined); }} className="rounded border border-stroke p-1">当前工程范围</button><button type="button" aria-pressed={scope === 'rc'} disabled={!candidate} onClick={() => { setScope('rc'); setReport(undefined); }} className="rounded border border-stroke p-1 disabled:opacity-40">选中 RC 范围</button><button type="button" disabled={busy} onClick={() => void preview()} className="rounded bg-cyan-700 px-2 py-1 text-white disabled:opacity-40">生成只读预览</button></div>
    {report && <article aria-label="发布证据审计预览" className="mt-2 space-y-1 rounded border border-stroke p-2 text-[10px]">
      <p>{report.scope}</p><p>节点 {report.summary.nodes} · 关系 {report.summary.relationships} · 批次 {report.summary.batchSessions} · 回滚 {report.summary.batchRollbacks} · 异常 {report.summary.issues}</p>
      <p className="break-all">数据 SHA-256：{report.manifest.evidenceSha256}</p>
      {report.privacyBoundary.map((item) => <p key={item} className="text-ink-faint">边界：{item}</p>)}
      {Object.values(report.issues).flat().map((item, index) => <p key={`${index}:${item}`} className="text-amber-200">异常：{item}</p>)}
      <div className="flex flex-wrap gap-2 pt-1"><button type="button" onClick={() => download(`${JSON.stringify(report, null, 2)}\n`, 'application/json', `${prefix}.audit.json`)} className="rounded border border-cyan-300/30 px-2 py-1">下载审计 JSON</button><button type="button" onClick={() => download(publicationAuditReportToHtml(report), 'text/html;charset=utf-8', `${prefix}.audit.html`)} className="rounded border border-cyan-300/30 px-2 py-1">下载离线 HTML</button></div>
    </article>}
    <div className="mt-2 border-t border-stroke pt-2 text-[10px]">
      <p className="mb-1 font-semibold text-cyan-100">独立验证已有报告</p>
      <p className="mb-1 text-[9px] text-ink-faint">只读取文件文本并复算哈希；HTML 中的脚本不会执行，验证结果不会保存或导入。</p>
      <button type="button" disabled={busy} onClick={() => verificationInput.current?.click()} className="rounded border border-cyan-300/30 px-2 py-1 disabled:opacity-40">选择审计报告验证</button>
      <input ref={verificationInput} aria-label="选择审计报告验证文件" type="file" accept="application/json,text/html,.json,.html,.htm" className="hidden" onChange={(event) => { void verifyFile(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
    {verification && <article aria-label="审计报告验证结果" className="mt-2 space-y-1 rounded border border-stroke p-2 text-[10px]">
      <p className={verification.status === 'verified' ? 'text-emerald-200' : verification.status === 'unsupported' ? 'text-amber-200' : 'text-red-200'}>验证状态：{verification.status === 'verified' ? '全部通过' : verification.status === 'unsupported' ? '格式或字段不受支持' : '验证失败'}</p>
      <p>文件类型：{verification.fileType.toUpperCase()} · 格式：{verification.format ?? '缺失'} · 版本：{verification.version ?? '缺失'}</p>
      <p>范围：{verification.scope ?? '缺失'} · 生成时间：{verification.generatedAt ?? '缺失'}</p>
      {verification.sections.map((section) => <p key={section.name} className={section.status === 'verified' ? 'text-emerald-200' : 'text-red-200'}>{section.name}：{section.status === 'verified' ? '通过' : section.status === 'tampered' ? '篡改或不一致' : section.status === 'missing' ? '缺失' : '不支持'}</p>)}
      <p className={verification.evidence.status === 'verified' ? 'break-all text-emerald-200' : 'break-all text-red-200'}>整份证据：{verification.evidence.status === 'verified' ? '通过' : verification.evidence.status === 'tampered' ? '哈希不一致' : '哈希缺失'} · {verification.evidence.actualSha256 ?? '未计算'}</p>
      {verification.unknownFields.length > 0 && <p className="text-amber-200">未知字段：{verification.unknownFields.join('、')}</p>}
      {verification.errors.map((item) => <p key={item} className="text-red-200">问题：{item}</p>)}
    </article>}
    <div className="mt-2 border-t border-stroke pt-2 text-[10px]" aria-label="审计报告版本差异对比">
      <p className="mb-1 font-semibold text-cyan-100">两份已验证报告版本差异</p>
      <p className="mb-2 text-[9px] text-ink-faint">分别选择左右报告；只有两侧完整验证通过后才能比较。结果只陈述结构化变化，不判断哪个版本更优。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => comparisonLeftInput.current?.click()} className="rounded border border-cyan-300/30 px-2 py-1 disabled:opacity-40">选择左侧报告</button>
        <input ref={comparisonLeftInput} aria-label="选择左侧审计报告" type="file" accept="application/json,text/html,.json,.html,.htm" className="hidden" onChange={(event) => { void readComparisonFile('left', event.target.files?.[0]); event.target.value = ''; }} />
        <button type="button" disabled={busy} onClick={() => comparisonRightInput.current?.click()} className="rounded border border-cyan-300/30 px-2 py-1 disabled:opacity-40">选择右侧报告</button>
        <input ref={comparisonRightInput} aria-label="选择右侧审计报告" type="file" accept="application/json,text/html,.json,.html,.htm" className="hidden" onChange={(event) => { void readComparisonFile('right', event.target.files?.[0]); event.target.value = ''; }} />
        <button type="button" disabled={busy || !comparisonLeft?.report || !comparisonRight?.report} onClick={() => void generateComparison()} className="rounded bg-cyan-700 px-2 py-1 text-white disabled:opacity-40">生成版本差异</button>
      </div>
      {([['左侧', comparisonLeft], ['右侧', comparisonRight]] as const).map(([label, value]) => value && <div key={label} className="mt-2 rounded border border-stroke/70 p-2">
        <p className={value.report ? 'text-emerald-200' : 'text-red-200'}>{label}：{value.fileName} · {value.report ? '验证通过' : value.verification.status === 'unsupported' ? '格式不受支持' : '验证失败'}</p>
        {value.report && <><p>{value.report.id} · {value.report.scope} · {new Date(value.report.generatedAt).toLocaleString()}</p><p className="break-all">证据 SHA-256：{value.report.manifest.evidenceSha256}</p></>}
        {!value.report && value.verification.errors.map((item) => <p key={item} className="text-red-200">问题：{item}</p>)}
      </div>)}
    </div>
    {comparison && <article aria-label="审计报告版本差异预览" className="mt-2 space-y-1 rounded border border-cyan-300/25 p-2 text-[10px]">
      <p className="font-semibold text-cyan-100">版本差异只读预览</p>
      <p>新增 {comparison.summary.added} · 移除 {comparison.summary.removed} · 变化 {comparison.summary.changed} · 相同 {comparison.summary.identical}</p>
      {Object.values(comparison.sections).map((section) => <div key={section.name} className="rounded border border-stroke/70 p-1">
        <p>{section.label}：新增 {section.summary.added} · 移除 {section.summary.removed} · 变化 {section.summary.changed} · 相同 {section.summary.identical}</p>
        {section.items.filter((item) => item.status !== 'identical').map((item) => <div key={item.id} className="ml-2"><p className="break-all">{item.status} · {item.id} · 左 {item.leftSha256 ?? '无'} · 右 {item.rightSha256 ?? '无'}</p>{item.changes.map((change) => <p key={change.field} className="break-all text-ink-faint">字段 {change.field}：{JSON.stringify(change.before) ?? '无'} → {JSON.stringify(change.after) ?? '无'}</p>)}</div>)}
      </div>)}
      {comparison.warnings.map((item) => <p key={item} className="text-amber-200">提示：{item}</p>)}
      <p>{comparison.statement}</p><p className="break-all">差异 SHA-256：{comparison.manifest.comparisonSha256}</p>
      <div className="flex flex-wrap gap-2 pt-1"><button type="button" disabled={busy} onClick={() => void downloadComparison('json')} className="rounded border border-cyan-300/30 px-2 py-1 disabled:opacity-40">下载差异 JSON</button><button type="button" disabled={busy} onClick={() => void downloadComparison('html')} className="rounded border border-cyan-300/30 px-2 py-1 disabled:opacity-40">下载差异 HTML</button></div>
    </article>}
    <div className="mt-2 border-t border-stroke pt-2 text-[10px]" aria-label="版本差异独立验证器">
      <p className="mb-1 font-semibold text-cyan-100">独立验证版本差异</p>
      <p className="mb-1 text-[9px] text-ink-faint">只读取差异 JSON 或 HTML 并复算哈希；不会执行脚本、导入两侧报告、合并证据或写入工程。</p>
      <button type="button" disabled={busy} onClick={() => diffVerificationInput.current?.click()} className="rounded border border-cyan-300/30 px-2 py-1 disabled:opacity-40">选择版本差异验证</button>
      <input ref={diffVerificationInput} aria-label="选择版本差异验证文件" type="file" accept="application/json,text/html,.json,.html,.htm" className="hidden" onChange={(event) => { void verifyDiffFile(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
    {diffVerification && <article aria-label="版本差异验证结果" className="mt-2 space-y-1 rounded border border-stroke p-2 text-[10px]">
      <p className={diffVerification.status === 'verified' ? 'text-emerald-200' : diffVerification.status === 'unsupported' ? 'text-amber-200' : 'text-red-200'}>验证状态：{diffVerification.status === 'verified' ? '全部通过' : diffVerification.status === 'unsupported' ? '格式或字段不受支持' : '验证失败'}</p>
      <p>文件类型：{diffVerification.fileType.toUpperCase()} · 格式：{diffVerification.format ?? '缺失'} · 版本：{diffVerification.version ?? '缺失'} · 范围一致：{diffVerification.scopeMatch === undefined ? '缺失' : diffVerification.scopeMatch ? '是' : '否'}</p>
      <p>生成时间：{diffVerification.generatedAt ?? '缺失'}</p>
      <p className="break-all">左侧：{diffVerification.left?.id ?? '缺失'} · {diffVerification.left?.scope ?? '缺失'} · {diffVerification.left?.evidenceSha256 ?? '缺失'}</p>
      <p className="break-all">右侧：{diffVerification.right?.id ?? '缺失'} · {diffVerification.right?.scope ?? '缺失'} · {diffVerification.right?.evidenceSha256 ?? '缺失'}</p>
      {diffVerification.sections.map((section) => <p key={section.name} className={section.status === 'verified' ? 'text-emerald-200' : 'text-red-200'}>{section.name}：{section.status === 'verified' ? '通过' : section.status === 'tampered' ? '篡改或不一致' : section.status === 'missing' ? '缺失' : '不支持'}</p>)}
      <p className={diffVerification.comparison.status === 'verified' ? 'break-all text-emerald-200' : 'break-all text-red-200'}>整份差异：{diffVerification.comparison.status === 'verified' ? '通过' : diffVerification.comparison.status === 'tampered' ? '哈希不一致' : '哈希缺失'} · {diffVerification.comparison.actualSha256 ?? '未计算'}</p>
      {diffVerification.unknownFields.length > 0 && <p className="text-amber-200">未知字段：{diffVerification.unknownFields.join('、')}</p>}
      {diffVerification.errors.map((item) => <p key={item} className="text-red-200">问题：{item}</p>)}
    </article>}
    {message && <p role="status" className="mt-2 text-[10px] text-cyan-100">{message}</p>}
  </details>;
}
