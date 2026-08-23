import { scenePlanToSnapshot } from '@/lib/agent/scenePlan';
import { useEditorStore } from '@/store/editorStore';

function createTestScenePlan() {
  return {
    projectName: 'ScenePlan 测试工程',
    canvas: { width: 1920, height: 1080 },
    scenes: [
      {
        id: 'scene-1',
        duration: 4,
        blocks: [
          {
            type: 'text' as const,
            content: '一个想法，如何变成一条视频？',
            layoutPreset: 'top-title' as const,
            duration: 4,
          },
          {
            type: 'voice' as const,
            content: '先把主题拆成场景，再让每个场景拥有自己的画面和节奏。',
            layoutPreset: 'center-product' as const,
            duration: 4,
          },
        ],
      },
      {
        id: 'scene-2',
        duration: 5,
        blocks: [
          {
            type: 'card' as const,
            content: 'ScenePlan → ProjectSnapshot → HyperFrames',
            layoutPreset: 'feature-card' as const,
            duration: 5,
          },
          {
            type: 'subtitle' as const,
            content: '结构先稳定，模型以后再替换。',
            layoutPreset: 'bottom-subtitle' as const,
            duration: 5,
          },
        ],
      },
    ],
  };
}

/** ScenePlan 的独立测试入口；未来可把内部计划替换成 LLM 输出。 */
export default function ScenePlanLoader() {
  const handleLoad = () => {
    const plan = createTestScenePlan();
    const snapshot = scenePlanToSnapshot(plan, useEditorStore.getState().assets);
    useEditorStore.getState().importSnapshot(snapshot);
  };

  return (
    <button
      type="button"
      onClick={handleLoad}
      className="rounded-md border border-amber-300/40 bg-amber-300/10 px-2.5 py-[5px] text-[11px] font-medium text-amber-100 hover:bg-amber-300/20"
    >
      加载ScenePlan测试
    </button>
  );
}
