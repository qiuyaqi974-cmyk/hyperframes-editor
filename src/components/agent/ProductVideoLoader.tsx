import { generateProductVideoPlan } from '@/lib/agent/productVideoAgent';
import { ZhipuProvider } from '@/lib/agent/providers/zhipuProvider';
import { scenePlanToSnapshot } from '@/lib/agent/scenePlan';
import { useEditorStore } from '@/store/editorStore';

/** 商品视频 Agent 的本地测试入口；未来只需替换 Agent 函数实现即可接 GPT。 */
export default function ProductVideoLoader() {
  const handleGenerate = async () => {
    const productName = window.prompt('商品名称', '便携榨汁杯');
    if (productName === null) return;
    const targetAudience = window.prompt('目标用户', '办公室女性、学生');
    if (targetAudience === null) return;
    const rawPoints = window.prompt('卖点（每行一个）', '小巧便携\n充电使用\n快速榨汁\n清洗方便');
    if (rawPoints === null) return;

    try {
      const provider = new ZhipuProvider();
      console.log('Using ZhipuProvider');
      const sellingPoints = rawPoints
        .split(/[\n,，、]/)
        .map((point) => point.trim())
        .filter(Boolean);
      console.log('Calling LLM provider');
      const plan = await generateProductVideoPlan(
        {
          productName,
          targetAudience,
          sellingPoints,
          duration: 30,
        },
        provider,
      );
      console.log('Generated ScenePlan:', plan);
      const snapshot = scenePlanToSnapshot(plan);
      useEditorStore.getState().importSnapshot(snapshot);
    } catch (error) {
      window.alert(`商品视频生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGenerate}
      className="rounded-md border border-emerald-300/40 bg-emerald-300/10 px-2.5 py-[5px] text-[11px] font-medium text-emerald-100 hover:bg-emerald-300/20"
    >
      生成商品视频
    </button>
  );
}
