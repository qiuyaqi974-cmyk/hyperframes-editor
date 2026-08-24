import { useState } from 'react';
import { generateDirectorPlan } from '@/lib/directorAgent/directorAgent';
import { generateSceneBlueprints } from '@/lib/sceneBlueprint/blueprintGenerator';
import directorTemplatesV2 from '@/lib/contentDirector/director-templates-v2.json';

export default function DirectorAgentLoader() {
  const [topic, setTopic] = useState('为什么普通人应该学习AI');
  const [goal, setGoal] = useState('涨粉');
  const [contentType, setContentType] = useState('knowledge');
  const [status, setStatus] = useState('');

  const handleGenerate = () => {
    try {
      const blueprints = generateSceneBlueprints(directorTemplatesV2);
      const plan = generateDirectorPlan({ topic, goal, contentType }, blueprints);
      const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'director-plan.json';
      anchor.click();
      URL.revokeObjectURL(url);
      console.log('导演方案生成完成：', plan.templateId);
      setStatus(`生成完成：${plan.scenes.length} 个场景`);
    } catch (error) {
      setStatus(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="主题" className="w-24 rounded border border-stroke bg-panel-3 px-1.5 py-1 text-[11px] text-ink" />
      <input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="目标" className="w-32 rounded border border-stroke bg-panel-3 px-1.5 py-1 text-[11px] text-ink" />
      <input value={contentType} onChange={(event) => setContentType(event.target.value)} placeholder="内容类型" className="w-20 rounded border border-stroke bg-panel-3 px-1.5 py-1 text-[11px] text-ink" />
      <button type="button" onClick={handleGenerate} className="rounded-md border border-sky-300/40 bg-sky-300/10 px-2.5 py-[5px] text-[11px] font-medium text-sky-100 hover:bg-sky-300/20">
        生成导演方案
      </button>
      {status && <span className="text-[10px] text-ink-faint">{status}</span>}
    </span>
  );
}
