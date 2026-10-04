import { useState } from 'react';
import { scenePlanToSnapshot } from '@/lib/agent/scenePlan';
import { generateDirectorPlan } from '@/lib/directorAgent/directorAgent';
import { directorPlanToScenePlan } from '@/lib/directorAgent/directorPlanAdapter';
import { generateSceneBlueprints } from '@/lib/sceneBlueprint/blueprintGenerator';
import { useEditorStore } from '@/store/editorStore';
import directorTemplatesV2 from '@/lib/contentDirector/director-templates-v2.json';

/** 使用工程级导演决策生成场景；所有输入来自持久化 brief，而不是临时表单。 */
export default function DirectorAgentLoader() {
  const [status, setStatus] = useState('');

  const buildPlan = () => {
    const state = useEditorStore.getState();
    const director = state.director;
    if (!director.objective || !director.audience || !director.thesis) {
      throw new Error('请先在“导演决策层”填写目标、受众和核心表达。');
    }
    const blueprints = generateSceneBlueprints(directorTemplatesV2);
    return generateDirectorPlan({
      topic: director.thesis,
      goal: director.objective,
      contentType: director.contentType,
      audience: director.audience,
      tone: director.tone,
      pacing: director.pacing,
      emotionArc: director.emotionArc,
      endingAction: director.endingAction,
      visualRules: director.visualRules,
    }, blueprints);
  };

  const handleApply = () => {
    try {
      const plan = buildPlan();
      const scenePlan = directorPlanToScenePlan(plan);
      const state = useEditorStore.getState();
      state.importGeneratedSnapshot(scenePlanToSnapshot(scenePlan, state.assets));
      setStatus(`已按导演决策生成 ${plan.scenes.length} 个场景。`);
    } catch (error) {
      setStatus(`无法应用：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleExport = () => {
    try {
      const plan = buildPlan();
      const url = URL.createObjectURL(new Blob([JSON.stringify({ director: useEditorStore.getState().director, plan }, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'director-plan.json';
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(`导演方案已导出：${plan.scenes.length} 个场景。`);
    } catch (error) {
      setStatus(`无法导出：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1.5">
      <span className="grid grid-cols-2 gap-1.5">
        <button type="button" onClick={handleApply} className="rounded-md border border-sky-300/40 bg-sky-300/10 px-2 py-[5px] text-[10.5px] font-medium text-sky-100 hover:bg-sky-300/20">应用导演决策</button>
        <button type="button" onClick={handleExport} className="rounded-md border border-sky-300/40 bg-sky-300/10 px-2 py-[5px] text-[10.5px] font-medium text-sky-100 hover:bg-sky-300/20">导出导演方案</button>
      </span>
      {status && <span className="text-[10px] leading-relaxed text-ink-faint">{status}</span>}
    </span>
  );
}
