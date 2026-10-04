import { useMemo } from 'react';
import {
  applyRoughCutRoleTemplate,
  assignRoughCutRole,
  confirmRoughCutStructure,
  moveRoughCutCandidate,
  roughCutPlanReadiness,
  syncRoughCutDirectorContext,
} from '@/lib/roughCutPlan';
import { useEditorStore } from '@/store/editorStore';
import type { ExternalMediaSource, NarrativeRole, SourceRoughCutPlan } from '@/types';

interface Props {
  source: ExternalMediaSource;
  onMessage: (message: string) => void;
}

const roles: Array<{ value: NarrativeRole; label: string }> = [
  { value: 'hook', label: '开场钩子' },
  { value: 'context', label: '背景 / 准备' },
  { value: 'argument', label: '核心步骤 / 观点' },
  { value: 'proof', label: '证明 / 结果' },
  { value: 'turn', label: '转折' },
  { value: 'cta', label: '结尾行动' },
  { value: 'custom', label: '自定义职责' },
];

const contentTypeLabel = {
  knowledge: '知识', product: '产品', story: '故事', tutorial: '教程', other: '通用',
} as const;

export default function RoughCutStructurePanel({ source, onMessage }: Props) {
  const director = useEditorStore((state) => state.director);
  const updateSourceMedia = useEditorStore((state) => state.updateSourceMedia);
  const plan = source.roughCutPlan;
  const readiness = useMemo(() => plan ? roughCutPlanReadiness(plan, director.updatedAt) : null, [plan, director.updatedAt]);
  if (!plan || !readiness?.kept.length) return null;

  const locked = Boolean(plan.appliedBlockIds?.length);
  const update = (next: SourceRoughCutPlan) => updateSourceMedia(source.id, { roughCutPlan: next });
  const mutate = (action: () => SourceRoughCutPlan) => {
    if (locked) return onMessage('这份粗剪已经写入时间轴；请先撤销本次追加，再修改导演结构。');
    update(action());
  };

  const confirm = () => {
    if (locked) return;
    try {
      update(confirmRoughCutStructure(plan));
      onMessage(`导演结构已确认：将按当前顺序编排 ${readiness.kept.length} 个片段。`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return <div className="mt-2 rounded border border-fuchsia-300/20 bg-fuchsia-300/[0.035] p-2">
    <div className="flex items-start justify-between gap-2">
      <div>
        <h5 className="text-[9.5px] font-semibold text-fuchsia-100">导演结构编排</h5>
        <p className="mt-0.5 text-[8px] leading-relaxed text-ink-faint">决定这些片段为什么出现、以什么顺序出现。这里的顺序就是最终写入时间轴的顺序。</p>
      </div>
      <button type="button" disabled={locked} onClick={() => mutate(() => applyRoughCutRoleTemplate(plan, director.contentType))} className="shrink-0 rounded border border-fuchsia-300/25 px-1.5 py-1 text-[8px] text-fuchsia-100 disabled:opacity-40">按{contentTypeLabel[director.contentType]}结构预填</button>
    </div>

    <div className="mt-1.5 rounded border border-stroke bg-panel/50 px-2 py-1.5 text-[8px] leading-relaxed text-ink-faint">
      目标：{director.objective || '未填写'}<br />
      主旨：{director.thesis || '未填写'}
    </div>

    {readiness.directorStale && <div className="mt-1.5 flex items-center gap-1.5 rounded border border-amber-300/25 bg-amber-300/[0.05] p-1.5">
      <p className="min-w-0 flex-1 text-[8px] text-amber-100">导演 Brief 已变化，旧结构确认已失效。同步不会重置保留决定。</p>
      <button type="button" disabled={locked} onClick={() => mutate(() => syncRoughCutDirectorContext(plan, director))} className="shrink-0 rounded bg-amber-500 px-1.5 py-1 text-[8px] text-slate-950 disabled:opacity-40">同步当前 Brief</button>
    </div>}

    <div className="mt-1.5 space-y-1">
      {readiness.kept.map((candidate, index) => <div key={candidate.id} className="flex items-center gap-1 rounded border border-stroke bg-panel/60 p-1">
        <span className="w-4 shrink-0 text-center font-mono text-[8px] text-fuchsia-200">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[8.5px] text-ink-dim">{candidate.text}</p>
          <p className="text-[7px] text-ink-faint">原片 {candidate.start.toFixed(1)}–{candidate.end.toFixed(1)}s</p>
        </div>
        <select disabled={locked} value={candidate.narrativeRole ?? ''} onChange={(event) => mutate(() => assignRoughCutRole(plan, candidate.id, event.target.value as NarrativeRole))} className="max-w-28 rounded border border-stroke bg-panel px-1 py-0.5 text-[7.5px] text-ink outline-none disabled:opacity-40">
          <option value="" disabled>选择叙事职责</option>
          {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
        </select>
        <div className="flex shrink-0 flex-col gap-0.5">
          <button type="button" aria-label="向前移动" disabled={locked || index === 0} onClick={() => mutate(() => moveRoughCutCandidate(plan, candidate.id, -1))} className="rounded border border-stroke px-1 text-[7px] text-ink-faint disabled:opacity-25">↑</button>
          <button type="button" aria-label="向后移动" disabled={locked || index === readiness.kept.length - 1} onClick={() => mutate(() => moveRoughCutCandidate(plan, candidate.id, 1))} className="rounded border border-stroke px-1 text-[7px] text-ink-faint disabled:opacity-25">↓</button>
        </div>
      </div>)}
    </div>

    <div className="mt-1.5 flex items-center gap-1.5">
      <p className={`min-w-0 flex-1 text-[8px] ${readiness.structureConfirmed && !readiness.directorStale ? 'text-emerald-200' : 'text-ink-faint'}`}>
        {readiness.missingRoles.length ? `还有 ${readiness.missingRoles.length} 段未指定职责` : readiness.structureConfirmed && !readiness.directorStale ? '结构已确认；任何改动都会要求重新确认' : '职责和顺序已齐，请确认这个结构'}
      </p>
      <button type="button" disabled={locked || !readiness.structureComplete || readiness.directorStale} onClick={confirm} className="shrink-0 rounded bg-fuchsia-500 px-2 py-1 text-[8.5px] font-medium text-white disabled:opacity-40">{readiness.structureConfirmed && !readiness.directorStale ? '已确认结构' : '确认这个结构'}</button>
    </div>
  </div>;
}
