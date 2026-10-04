import { useState } from 'react';
import { generateProjectSnapshot } from '@/lib/agent/projectGenerator';
import { planContent } from '@/lib/agent/contentPlanner';
import { useEditorStore } from '@/store/editorStore';

/** 「AI生成工程」：主题 + 口播稿 → 直接生成可编辑工程 */
export function AgentGenerateButton() {
  const [expanded, setExpanded] = useState(false);
  const [topic, setTopic] = useState('');
  const [script, setScript] = useState('');
  const [status, setStatus] = useState('');

  const handleGenerate = () => {
    try {
      const snapshot = generateProjectSnapshot({ topic, script });
      useEditorStore.getState().importGeneratedSnapshot(snapshot);
      setStatus('工程已生成；下一步补齐真实配音。');
      setExpanded(false);
    } catch (error) {
      setStatus(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-2.5 py-[6px] text-left text-[11px] font-medium text-cyan-100 hover:bg-cyan-300/20"
      >
        快速生成可编辑工程 {expanded ? '−' : '+'}
      </button>
      {expanded && (
        <span className="grid gap-1.5 rounded-md border border-stroke bg-panel-3/70 p-2">
          <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="视频主题" className="rounded border border-stroke bg-panel px-2 py-1.5 text-[11px] text-ink outline-none focus:border-cyan-300/50" />
          <textarea value={script} onChange={(event) => setScript(event.target.value)} placeholder="粘贴完整口播稿" rows={4} className="resize-y rounded border border-stroke bg-panel px-2 py-1.5 text-[11px] leading-relaxed text-ink outline-none focus:border-cyan-300/50" />
          <button type="button" onClick={handleGenerate} disabled={!script.trim()} className="rounded bg-cyan-400 px-2.5 py-1.5 text-[11px] font-semibold text-[#08202a] disabled:cursor-not-allowed disabled:opacity-40">生成工程</button>
        </span>
      )}
      {status && <span className="text-[10px] leading-relaxed text-ink-faint">{status}</span>}
    </span>
  );
}

/** 「AI规划内容」：主题 → 内容规划预览 */
export function ContentPlanButton() {
  const handleContentPlan = () => {
    const topic = window.prompt('输入主题', '如何把一个想法变成可执行的视频工程');
    if (topic === null) return;
    try {
      const plan = planContent(topic);
      const sceneText = plan.scenes
        .map((scene, index) => `${index + 1}. ${scene.text}\n   画面：${scene.visual} · ${scene.duration}s`)
        .join('\n\n');
      window.alert(`标题：${plan.title}\n\n脚本：\n${plan.script}\n\n场景规划：\n${sceneText}`);
    } catch (error) {
      alert(`内容规划失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleContentPlan}
      className="w-full rounded-md border border-violet-300/40 bg-violet-300/10 px-2.5 py-[6px] text-[11px] font-medium text-violet-100 text-left hover:bg-violet-300/20"
    >
      AI规划内容
    </button>
  );
}
