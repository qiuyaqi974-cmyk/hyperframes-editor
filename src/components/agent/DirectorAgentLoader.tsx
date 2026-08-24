import { useRef, useState } from 'react';
import { generateDirectorPlan } from '@/lib/directorAgent/directorAgent';

export default function DirectorAgentLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [topic, setTopic] = useState('便携榨汁杯');
  const [goal, setGoal] = useState('让观众理解产品价值并采取行动');
  const [contentType, setContentType] = useState('product');
  const [status, setStatus] = useState('');

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const blueprints = JSON.parse(await file.text()) as unknown;
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
      <select value={contentType} onChange={(event) => setContentType(event.target.value)} className="rounded border border-stroke bg-panel-3 px-1.5 py-1 text-[11px] text-ink">
        <option value="product">商品</option>
        <option value="knowledge">知识</option>
      </select>
      <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-sky-300/40 bg-sky-300/10 px-2.5 py-[5px] text-[11px] font-medium text-sky-100 hover:bg-sky-300/20">
        生成导演方案
      </button>
      <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
      {status && <span className="text-[10px] text-ink-faint">{status}</span>}
    </span>
  );
}
