import { generateProjectSnapshot } from '@/lib/agent/projectGenerator';
import { planContent } from '@/lib/agent/contentPlanner';
import { useEditorStore } from '@/store/editorStore';

/** 「AI生成工程」：主题 + 口播稿 → 直接生成可编辑工程 */
export function AgentGenerateButton() {
  const handleGenerate = () => {
    const topic = window.prompt('主题', '一个值得讲清楚的主题');
    if (topic === null) return;
    const script = window.prompt('脚本（可直接粘贴完整口播稿）', `${topic}\n\n请在这里输入口播稿。`);
    if (script === null) return;
    try {
      const snapshot = generateProjectSnapshot({ topic, script });
      useEditorStore.getState().importSnapshot(snapshot);
    } catch (error) {
      alert(`AI 生成工程失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGenerate}
      className="w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-2.5 py-[6px] text-[11px] font-medium text-cyan-100 text-left hover:bg-cyan-300/20"
    >
      AI生成工程
    </button>
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
