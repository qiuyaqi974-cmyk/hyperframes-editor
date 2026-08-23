import { generateProductVideoPlan } from '@/lib/agent/productVideoAgent';
import { ZhipuProvider } from '@/lib/agent/providers/zhipuProvider';
import { scenePlanToSnapshot } from '@/lib/agent/scenePlan';
import { useEditorStore } from '@/store/editorStore';
import type { ProjectSnapshot } from '@/types';

interface ElectronBridge {
  generateProductProject: (input: {
    productInfo: {
      productName: string;
      targetAudience: string;
      sellingPoints: string[];
    };
  }) => Promise<{ snapshot: ProjectSnapshot }>;
}

/** 商品视频 Agent 的本地测试入口；未来只需替换 Agent 函数实现即可接 GPT。 */
export default function ProductVideoLoader() {
  const handleGenerate = async () => {
    try {
      const productInfo = {
        productName: '便携榨汁杯',
        targetAudience: '办公室女性、学生',
        sellingPoints: ['小巧便携', '充电使用', '快速榨汁', '清洗方便'],
      };
      const bridge = (window as Window & { hyperframesElectron?: ElectronBridge }).hyperframesElectron;
      if (bridge?.generateProductProject) {
        const { snapshot } = await bridge.generateProductProject({ productInfo });
        useEditorStore.getState().importSnapshot(snapshot);
        return;
      }
      const provider = new ZhipuProvider();
      console.log('Using ZhipuProvider');
      console.log('Calling LLM provider');
      const plan = await generateProductVideoPlan(
        {
          ...productInfo,
          duration: 30,
        },
        provider,
      );
      console.log('Generated ScenePlan:', plan);
      const snapshot = scenePlanToSnapshot(plan, useEditorStore.getState().assets);
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
