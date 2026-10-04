import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';
import type { PostPublishObservation, PostPublishObservationInput } from '@/lib/postPublishFeedback';
import type { PostPublishBatchSessionDraft } from '@/lib/postPublishBatchSession';
import { deletePlatformMappingTemplate, loadPlatformMappingTemplates, savePlatformMappingTemplate } from '@/lib/persistence';
import {
  applyPlatformMappingTemplate,
  confirmPlatformBatch,
  confirmPlatformMapping,
  createPlatformMappingTemplate,
  parsePlatformExportFile,
  previewPlatformBatch,
  previewPlatformMapping,
  suggestPlatformMappings,
  TARGET_LABELS,
  unitsForPlatformTarget,
  type PlatformExportDataset,
  type PlatformFieldMapping,
  type PlatformFieldUnit,
  type PlatformMappingTemplate,
  type PlatformTargetField,
} from '@/lib/platformDataAdapter';

const unitLabel: Record<PlatformFieldUnit, string> = {
  text: '文本', datetime: '日期时间', count: '次数', seconds: '秒', percent: '百分数 0–100', ratio: '比例 0–1',
  'retention-percent': '秒:百分数', 'retention-ratio': '秒:比例',
};

function sample(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const text = value == null ? '' : String(value);
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

export default function PlatformDataAdapter({ candidates, existingObservations, onSave, onSaveBatch }: { candidates: ReleaseCandidate[]; existingObservations: PostPublishObservation[]; onSave: (input: PostPublishObservationInput) => Promise<void>; onSaveBatch: (inputs: PostPublishObservationInput[], draft: PostPublishBatchSessionDraft) => Promise<void> }) {
  const [dataset, setDataset] = useState<PlatformExportDataset>();
  const [mappings, setMappings] = useState<PlatformFieldMapping[]>([]);
  const [rowIndex, setRowIndex] = useState(0);
  const [context, setContext] = useState({ rcId: '', platform: '', accountLabel: '', manualObservedAt: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [templates, setTemplates] = useState<PlatformMappingTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [activeTemplateId, setActiveTemplateId] = useState('');
  const [rowStates, setRowStates] = useState<Array<{ rcId: string; confirmed: boolean }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => dataset ? previewPlatformMapping(dataset, rowIndex, mappings, context) : undefined, [dataset, rowIndex, mappings, context]);
  const batchPreview = useMemo(() => dataset && mode === 'batch' && activeTemplateId ? previewPlatformBatch(dataset, mappings, context, rowStates, existingObservations) : undefined, [dataset, mode, activeTemplateId, mappings, context, rowStates, existingObservations]);

  useEffect(() => { void loadPlatformMappingTemplates().then((items) => { setTemplates(items); setSelectedTemplateId((current) => current || items[0]?.id || ''); }); }, []);

  const load = async (file?: File) => {
    if (!file) return;
    setBusy(true); setMessage('正在读取平台导出文件…'); setConfirmed(false);
    try {
      const next = await parsePlatformExportFile(file);
      setDataset(next); setMappings(suggestPlatformMappings(next.headers)); setRowIndex(0); setMode('single'); setActiveTemplateId('');
      setRowStates(next.rows.map(() => ({ rcId: '', confirmed: false })));
      setMessage(`已读取 ${next.rows.length} 行、${next.headers.length} 列。别名匹配仅是待确认建议。`);
    } catch (error) { setDataset(undefined); setMappings([]); setMessage(`读取失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const updateMapping = (sourceField: string, patch: Partial<PlatformFieldMapping>) => {
    setConfirmed(false);
    setMappings((current) => current.map((item) => {
      if (item.sourceField !== sourceField) return item;
      const targetField = patch.targetField ?? item.targetField;
      const allowed = unitsForPlatformTarget(targetField);
      const nextUnit = patch.unit && allowed.includes(patch.unit) ? patch.unit : allowed.includes(item.unit) ? item.unit : allowed[0];
      return { ...item, ...patch, targetField, unit: nextUnit, suggested: false };
    }));
    setActiveTemplateId('');
  };

  const saveTemplate = async () => {
    if (!dataset) return;
    try {
      const template = createPlatformMappingTemplate(templateName, dataset, mappings, context, confirmed);
      await savePlatformMappingTemplate(template);
      setTemplates((current) => [template, ...current]); setSelectedTemplateId(template.id); setActiveTemplateId(template.id);
      setMappings(template.mappings); setConfirmed(false); setMessage(`已保存人工确认模板“${template.name}”；模板不包含 RC 或具体行时间。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const applyTemplate = () => {
    if (!dataset) return;
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template) { setMessage('请选择一个已保存模板。'); return; }
    try {
      const applied = applyPlatformMappingTemplate(template, dataset);
      setMappings(applied.mappings); setContext((current) => ({ ...current, platform: applied.platform, accountLabel: applied.accountLabel, manualObservedAt: '' }));
      setActiveTemplateId(template.id); setConfirmed(false); setRowStates(dataset.rows.map(() => ({ rcId: '', confirmed: false })));
      setMessage(`已套用模板“${template.name}”；每一行仍需单独选择 RC 并确认关键时间。`);
    } catch (error) { setActiveTemplateId(''); setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const removeTemplate = async () => {
    if (!selectedTemplateId) return;
    await deletePlatformMappingTemplate(selectedTemplateId);
    const next = templates.filter((item) => item.id !== selectedTemplateId);
    setTemplates(next); setSelectedTemplateId(next[0]?.id ?? ''); if (activeTemplateId === selectedTemplateId) setActiveTemplateId('');
    setMessage('映射模板已删除。');
  };

  const save = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await onSave(confirmPlatformMapping(preview, confirmed));
      setMessage('平台数据已按确认映射转换为标准发布观察；自动生成的洞察仍等待人工判断。');
      setDataset(undefined); setMappings([]); setConfirmed(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const saveBatch = async () => {
    if (!batchPreview || busy) return;
    setBusy(true);
    try {
      const inputs = confirmPlatformBatch(batchPreview);
      const template = templates.find((item) => item.id === activeTemplateId);
      const confirmedAt = inputs[0]?.source.mappingReceipt?.confirmedAt;
      if (!dataset || !template || !confirmedAt) throw new Error('批次缺少已确认模板、文件或统一确认时间。');
      const draft: PostPublishBatchSessionDraft = {
        sourceFileName: dataset.fileName,
        sourceFileSha256: dataset.fileSha256,
        format: dataset.format,
        template: structuredClone(template),
        confirmedAt,
      };
      await onSaveBatch(inputs, draft);
      setMessage(`已完整保存 ${inputs.length} 行标准观察及不可变批次会话；没有跳过任何冲突或无效行。`);
      setDataset(undefined); setMappings([]); setRowStates([]); setConfirmed(false); setMode('single');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const inputClass = 'min-w-0 rounded border border-stroke bg-panel px-2 py-1 text-[9.5px] text-ink outline-none';
  return <div aria-label="发布数据平台适配器" className="col-span-2 space-y-2 rounded border border-violet-300/20 bg-violet-300/[0.035] p-2">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-violet-100">平台导出字段适配</span>
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="rounded border border-violet-300/30 px-2 py-1 text-violet-100 disabled:opacity-40">读取 CSV / XLSX / JSON</button>
      <input ref={inputRef} aria-label="选择平台导出文件" type="file" accept=".csv,.tsv,.xlsx,.json,application/json,text/csv" className="hidden" onChange={(event) => { void load(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
    <p>不连接平台账号。文件读取后只做预览；平台、账号、RC、字段、单位和时间窗必须人工确认。</p>
    {dataset && preview && <div className="space-y-2">
      <p className="break-all">{dataset.fileName} · {dataset.format.toUpperCase()} · SHA-256 {dataset.fileSha256} · {dataset.rows.length} 行</p>
      <div className="grid grid-cols-[1fr_auto_auto] gap-1.5 rounded border border-violet-300/20 p-2">
        <select aria-label="已保存平台映射模板" className={inputClass} value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}><option value="">选择已确认模板</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.platform}/{item.accountLabel}</option>)}</select>
        <button type="button" onClick={applyTemplate} className="rounded border border-violet-300/30 px-2 py-1 text-violet-100">套用模板</button>
        <button type="button" disabled={!selectedTemplateId} onClick={() => void removeTemplate()} className="rounded border border-red-300/20 px-2 py-1 text-red-100 disabled:opacity-40">删除</button>
        <input aria-label="新映射模板名称" className={inputClass} placeholder="模板名称，如 B站后台导出 v1" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
        <button type="button" onClick={() => void saveTemplate()} className="col-span-2 rounded border border-emerald-300/30 px-2 py-1 text-emerald-100">保存当前确认映射为模板</button>
        <p className="col-span-3 text-ink-faint">模板保存字段、单位、平台和账号；不会保存 RC、内容 ID 或任何具体行时间。</p>
      </div>
      <div className="flex gap-1.5"><button type="button" onClick={() => setMode('single')} className={`rounded px-2 py-1 ${mode === 'single' ? 'bg-violet-600 text-white' : 'border border-stroke'}`}>单行导入</button><button type="button" onClick={() => { setMode('batch'); setConfirmed(false); }} className={`rounded px-2 py-1 ${mode === 'batch' ? 'bg-violet-600 text-white' : 'border border-stroke'}`}>安全批次导入</button></div>
      <div className="grid grid-cols-2 gap-1.5">
        {mode === 'single' && <><select aria-label="平台导出对应 RC" className={inputClass} value={context.rcId} onChange={(event) => { setConfirmed(false); setContext({ ...context, rcId: event.target.value }); }}><option value="">选择冻结 RC</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.render?.sha256?.slice(0, 10)}…</option>)}</select>
        <select aria-label="平台导出数据行" className={inputClass} value={rowIndex} onChange={(event) => { setConfirmed(false); setRowIndex(Number(event.target.value)); }}>{dataset.rows.map((row, index) => <option key={index} value={index}>第 {index + 2} 行 · {dataset.headers.slice(0, 2).map((header) => sample(row[header])).join(' · ')}</option>)}</select></>}
        <input aria-label="平台导出所属平台" className={inputClass} placeholder="人工填写平台" value={context.platform} onChange={(event) => { setConfirmed(false); setActiveTemplateId(''); setContext({ ...context, platform: event.target.value }); }} />
        <input aria-label="平台导出账号标识" className={inputClass} placeholder="人工填写账号/数据源" value={context.accountLabel} onChange={(event) => { setConfirmed(false); setActiveTemplateId(''); setContext({ ...context, accountLabel: event.target.value }); }} />
        {mode === 'single' && !mappings.some((item) => item.targetField === 'observedAt') && <label className="col-span-2">文件对应的观测时间<input aria-label="平台导出手工观测时间" type="datetime-local" className={`${inputClass} mt-0.5 w-full`} value={context.manualObservedAt} onChange={(event) => { setConfirmed(false); setContext({ ...context, manualObservedAt: event.target.value }); }} /></label>}
      </div>
      <div className="max-h-64 overflow-auto rounded border border-stroke">
        <table className="w-full border-collapse text-left"><thead className="sticky top-0 bg-panel"><tr><th className="p-1.5">源字段 / 当前行样本</th><th className="p-1.5">目标字段</th><th className="p-1.5">单位</th></tr></thead><tbody>{mappings.map((mapping) => <tr key={mapping.sourceField} className="border-t border-stroke">
          <td className="max-w-48 p-1.5"><p className="font-medium text-ink">{mapping.sourceField}{mapping.suggested && <span className="ml-1 text-amber-100">待确认建议</span>}</p><p className="truncate text-ink-faint">{sample(dataset.rows[rowIndex]?.[mapping.sourceField]) || '空'}</p></td>
          <td className="p-1.5"><select aria-label={`${mapping.sourceField} 目标字段`} className={inputClass} value={mapping.targetField} onChange={(event) => updateMapping(mapping.sourceField, { targetField: event.target.value as PlatformTargetField })}>{Object.entries(TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
          <td className="p-1.5"><select aria-label={`${mapping.sourceField} 指标单位`} className={inputClass} value={mapping.unit} onChange={(event) => updateMapping(mapping.sourceField, { unit: event.target.value as PlatformFieldUnit })}>{unitsForPlatformTarget(mapping.targetField).map((unit) => <option key={unit} value={unit}>{unitLabel[unit]}</option>)}</select></td>
        </tr>)}</tbody></table>
      </div>
      {mode === 'single' && <><div aria-label="平台字段映射预览" className="space-y-1 rounded border border-stroke p-2">
        <p className="font-semibold text-ink">转换预览</p>
        {preview.mapped.map((item) => <p key={item.sourceField}>{item.sourceField} → {TARGET_LABELS[item.targetField]}（{unitLabel[item.unit]}）：{sample(item.rawValue)} → {sample(item.convertedValue)}</p>)}
        {preview.windowHours !== undefined && <p className="text-violet-100">时间窗：{preview.windowHours} 小时</p>}
        {preview.warnings.map((item) => <p key={item} className="text-amber-100">提示：{item}</p>)}
        {preview.blockers.map((item) => <p key={item} className="text-red-200">阻断：{item}</p>)}
      </div>
      <label className="block"><input aria-label="确认平台字段映射" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> 我已核对所选行、RC/成片哈希、平台、账号、内容 ID、字段单位、时间窗和未导入列</label>
      <button type="button" disabled={busy || !confirmed || preview.blockers.length > 0} onClick={() => void save()} className="rounded bg-violet-600 px-2 py-1.5 text-white disabled:opacity-40">按确认映射保存标准观察</button></>}
      {mode === 'batch' && !activeTemplateId && <p className="rounded border border-amber-300/30 bg-amber-300/[0.04] p-2 text-amber-100">安全批次必须先套用一个已保存且表头完全匹配的人工确认模板。</p>}
      {mode === 'batch' && batchPreview && <div aria-label="平台安全批次预览" className="space-y-2">
        <p className="font-semibold text-violet-100">批次逐行确认 · 共 {batchPreview.rows.length} 行 · 不允许跳过错误行</p>
        <div className="max-h-80 space-y-1.5 overflow-auto">{batchPreview.rows.map((row) => {
          const value = (target: PlatformTargetField) => row.mapped.find((item) => item.targetField === target)?.convertedValue;
          const hardBlockers = row.blockers.filter((item) => !item.includes('尚未人工确认'));
          return <article key={row.rowIndex} aria-label={`批次第 ${row.rowIndex + 2} 行`} className={`space-y-1 rounded border p-2 ${hardBlockers.length ? 'border-red-300/30' : row.confirmed ? 'border-emerald-300/30' : 'border-stroke'}`}>
            <p className="font-semibold text-ink">文件第 {row.rowIndex + 2} 行 · 内容 ID {sample(value('contentId')) || '缺失'}</p>
            <p>发布时间 {sample(value('publishedAt')) || '缺失'} · 观测时间 {sample(value('observedAt')) || '缺失'} · 时间窗 {row.windowHours ?? '—'} 小时</p>
            <select aria-label={`第 ${row.rowIndex + 2} 行对应 RC`} className={`${inputClass} w-full`} value={rowStates[row.rowIndex]?.rcId ?? ''} onChange={(event) => setRowStates((current) => current.map((item, index) => index === row.rowIndex ? { rcId: event.target.value, confirmed: false } : item))}><option value="">逐行选择冻结 RC</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.render?.sha256?.slice(0, 10)}…</option>)}</select>
            {row.warnings.map((item) => <p key={item} className="text-amber-100">提示：{item}</p>)}
            {hardBlockers.map((item) => <p key={item} className="text-red-200">阻断：{item}</p>)}
            <label className="block"><input aria-label={`确认批次第 ${row.rowIndex + 2} 行`} type="checkbox" disabled={hardBlockers.length > 0} checked={row.confirmed} onChange={(event) => setRowStates((current) => current.map((item, index) => index === row.rowIndex ? { ...item, confirmed: event.target.checked } : item))} /> 我已核对本行 RC/成片哈希、内容 ID、发布时间和观测时间</label>
          </article>;
        })}</div>
        {batchPreview.blockers.length > 0 && <p className="text-red-200">整批仍有 {batchPreview.blockers.length} 个阻断项；不会保存任何一行。</p>}
        <button type="button" disabled={busy || !batchPreview.ready} onClick={() => void saveBatch()} className="rounded bg-violet-600 px-2 py-1.5 text-white disabled:opacity-40">完整保存 {batchPreview.rows.length} 行标准观察</button>
      </div>}
    </div>}
    {message && <p role="status" className="text-violet-100">{message}</p>}
  </div>;
}
