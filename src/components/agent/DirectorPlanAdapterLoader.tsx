import { useRef, useState } from 'react';
import { scenePlanToSnapshot } from '@/lib/agent/scenePlan';
import type { ScenePlan } from '@/lib/agent/scenePlan';
import { directorPlanToScenePlan } from '@/lib/directorAgent/directorPlanAdapter';
import { useEditorStore } from '@/store/editorStore';

export default function DirectorPlanAdapterLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [currentScenePlan, setCurrentScenePlan] = useState<ScenePlan | null>(null);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const directorPlan = JSON.parse(await file.text());
      const scenePlan = directorPlanToScenePlan(directorPlan);
      const snapshot = scenePlanToSnapshot(scenePlan, useEditorStore.getState().assets);
      useEditorStore.getState().importSnapshot(snapshot);
      setCurrentScenePlan(scenePlan);
      setStatus(`已导入：${scenePlan.scenes.length} 个场景`);
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleExport = () => {
    if (!currentScenePlan) {
      setStatus('暂无ScenePlan。');
      return;
    }
    const blob = new Blob([JSON.stringify(currentScenePlan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'scene-plan.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('ScenePlan 已导出');
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-teal-300/40 bg-teal-300/10 px-2.5 py-[5px] text-[11px] font-medium text-teal-100 hover:bg-teal-300/20">
        导入导演方案测试
      </button>
      <button type="button" onClick={handleExport} className="rounded-md border border-teal-300/40 bg-teal-300/10 px-2.5 py-[5px] text-[11px] font-medium text-teal-100 hover:bg-teal-300/20">
        导出当前ScenePlan
      </button>
      <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
      {status && <span className="text-[10px] text-ink-faint">{status}</span>}
    </span>
  );
}
