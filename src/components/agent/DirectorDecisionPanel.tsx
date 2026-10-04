import { useState } from 'react';
import { sceneDecisionFor } from '@/lib/directorDecision';
import { useEditorStore } from '@/store/editorStore';
import type { DirectorDecision, NarrativeRole } from '@/types';

const ROLE_LABELS: Record<NarrativeRole, string> = {
  hook: '钩子',
  context: '建立语境',
  argument: '展开观点',
  proof: '提供证据',
  turn: '制造转折',
  cta: '行动引导',
  custom: '自定义',
};

export default function DirectorDecisionPanel() {
  const [expanded, setExpanded] = useState(false);
  const director = useEditorStore((state) => state.director);
  const scenes = useEditorStore((state) => state.scenes);
  const updateDirector = useEditorStore((state) => state.updateDirector);
  const updateSceneDecision = useEditorStore((state) => state.updateSceneDecision);
  const briefScore = [director.objective, director.audience, director.thesis].filter((value) => value.trim()).length;
  const currentSceneIds = new Set(scenes.map((scene) => scene.id));
  const lockedCount = Object.values(director.scenes).filter((decision) => decision.locked && currentSceneIds.has(decision.sceneId)).length;

  const field = <K extends keyof Omit<DirectorDecision, 'scenes' | 'updatedAt'>>(key: K, value: DirectorDecision[K]) => {
    updateDirector({ [key]: value } as Partial<Omit<DirectorDecision, 'scenes' | 'updatedAt'>>);
  };

  return (
    <section className="rounded-xl border border-violet-300/30 bg-gradient-to-br from-violet-300/10 to-fuchsia-400/5 p-3">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-3 text-left">
        <span>
          <span className="block text-[12px] font-semibold text-violet-50">导演决策层</span>
          <span className="mt-0.5 block text-[10px] text-violet-100/60">所有 Agent 共同遵守的创作边界</span>
        </span>
        <span className="text-right">
          <span className="block font-mono text-[10px] text-violet-100">Brief {briefScore}/3</span>
          <span className="block text-[9px] text-ink-faint">锁定 {lockedCount} 场景 · 学习引用 {director.learningApplications?.length ?? 0} {expanded ? '−' : '+'}</span>
        </span>
      </button>

      {!expanded && director.thesis && (
        <p className="mt-2 line-clamp-2 border-t border-violet-200/10 pt-2 text-[10px] leading-relaxed text-ink-dim">核心表达：{director.thesis}</p>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-violet-200/10 pt-3">
          <div className="grid grid-cols-2 gap-1.5">
            <select value={director.contentType} onChange={(event) => field('contentType', event.target.value as DirectorDecision['contentType'])} className="rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] text-ink outline-none">
              <option value="knowledge">知识观点</option><option value="product">商品内容</option><option value="story">故事叙事</option><option value="tutorial">操作教程</option><option value="other">其他</option>
            </select>
            <select value={director.pacing} onChange={(event) => field('pacing', event.target.value as DirectorDecision['pacing'])} className="rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] text-ink outline-none">
              <option value="calm">舒缓节奏</option><option value="balanced">平衡节奏</option><option value="fast">高密度快节奏</option>
            </select>
          </div>
          <input value={director.objective} onChange={(event) => field('objective', event.target.value)} placeholder="传播目标：看完后希望发生什么？" className="w-full rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] text-ink outline-none focus:border-violet-300/50" />
          <input value={director.audience} onChange={(event) => field('audience', event.target.value)} placeholder="核心受众：这条视频只对谁说？" className="w-full rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] text-ink outline-none focus:border-violet-300/50" />
          <textarea value={director.thesis} onChange={(event) => field('thesis', event.target.value)} rows={2} placeholder="核心表达：这条视频最终只想讲清哪一件事？" className="w-full resize-y rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] leading-relaxed text-ink outline-none focus:border-violet-300/50" />
          <div className="grid grid-cols-2 gap-1.5">
            <input value={director.tone} onChange={(event) => field('tone', event.target.value)} placeholder="语气，如克制、锋利" className="rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] text-ink outline-none" />
            <input value={director.emotionArc} onChange={(event) => field('emotionArc', event.target.value)} placeholder="情绪弧线" className="rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] text-ink outline-none" />
          </div>
          <input value={director.endingAction} onChange={(event) => field('endingAction', event.target.value)} placeholder="结尾行动：关注、评论、购买或开始实践" className="w-full rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] text-ink outline-none" />
          <textarea value={director.visualRules} onChange={(event) => field('visualRules', event.target.value)} rows={2} placeholder="视觉原则：必须出现什么，避免什么？" className="w-full resize-y rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] leading-relaxed text-ink outline-none" />

          {(director.learningApplications?.length ?? 0) > 0 && (() => {
            const application = director.learningApplications![director.learningApplications!.length - 1];
            return <div className="space-y-1 rounded border border-violet-300/20 bg-violet-300/[0.035] p-2 text-[9.5px] text-ink-dim">
              <p className="font-semibold text-violet-100">最近一次学习证据更新</p>
              <p>{new Date(application.appliedAt).toLocaleString()} · 更新 {application.fields.join(' / ')} · 引用 {application.citations.length} 条</p>
              <p>{application.rationale}</p>
              {application.citations.map((citation) => <p key={`${application.proposalId}-${citation.recordId}`}>{citation.role === 'support' ? '支持' : citation.role === 'counterexample' ? '反例' : '背景'} · {citation.summary} · RC {citation.provenance.rcIds.join(' / ')} · SHA-256 {citation.provenance.renderSha256.join(' / ')}</p>)}
            </div>;
          })()}

          {scenes.length > 0 && (
            <div className="space-y-1.5 border-t border-stroke pt-2">
              <div className="flex items-center justify-between text-[10px] font-semibold text-ink-dim"><span>场景职责</span><span className="font-normal text-ink-faint">锁定后 AI 不得覆盖</span></div>
              {scenes.map((scene, index) => {
                const decision = sceneDecisionFor(director, scene, index, scenes.length);
                return (
                  <div key={scene.id} className={`rounded-md border p-2 ${decision.locked ? 'border-amber-300/35 bg-amber-300/[0.06]' : 'border-stroke bg-panel-2/60'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 shrink-0 text-center font-mono text-[10px] text-ink-faint">{index + 1}</span>
                      <select value={decision.narrativeRole} onChange={(event) => updateSceneDecision(scene.id, { narrativeRole: event.target.value as NarrativeRole })} className="min-w-0 flex-1 rounded border border-stroke bg-panel px-1.5 py-1 text-[10px] text-ink outline-none">
                        {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <button type="button" onClick={() => updateSceneDecision(scene.id, { locked: !decision.locked, narrativeRole: decision.narrativeRole })} className={`rounded px-2 py-1 text-[9.5px] ${decision.locked ? 'bg-amber-300 text-[#2a2108]' : 'border border-stroke text-ink-faint hover:text-ink'}`}>
                        {decision.locked ? '已锁定' : '锁定'}
                      </button>
                    </div>
                    <input value={decision.intent} onChange={(event) => updateSceneDecision(scene.id, { intent: event.target.value, narrativeRole: decision.narrativeRole })} placeholder={scene.text || '这一场要让观众理解或感受什么？'} className="mt-1.5 w-full rounded border border-stroke/70 bg-panel px-2 py-1 text-[10px] text-ink outline-none" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
