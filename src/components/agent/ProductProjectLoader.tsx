import type { ProductProjectInput } from '@/lib/agent/productProjectAgent';
import type { ProjectSnapshot } from '@/types';

interface ElectronBridge {
  generateProductProject: (input: ProductProjectInput) => Promise<{ snapshot: ProjectSnapshot }>;
}

/** 通过 Electron preload bridge 调用 Node 商品文件夹 Agent；普通浏览器不直接访问本地路径。 */
export default function ProductProjectLoader() {
  const handleGenerate = async () => {
    console.log('click generate product project');
    const bridge = (window as Window & { hyperframesElectron?: ElectronBridge }).hyperframesElectron;
    console.log('electron bridge', bridge);
    if (!bridge?.generateProductProject) {
      window.alert('请使用桌面版 HyperFrames 执行本地商品生成');
      return;
    }
    const productName = window.prompt('商品名称', '便携榨汁杯');
    if (productName === null) return;
    const targetAudience = window.prompt('目标用户', '办公室女性、学生');
    if (targetAudience === null) return;
    const rawPoints = window.prompt('卖点（每行一个）', '小巧便携\n充电使用\n快速榨汁\n清洗方便');
    if (rawPoints === null) return;

    try {
      console.log('calling window.hyperframesElectron.generateProductProject');
      const { snapshot } = await bridge.generateProductProject({
        folderPath: '',
        productInfo: {
          productName,
          targetAudience,
          sellingPoints: rawPoints.split(/[\n,，、]/).map((point) => point.trim()).filter(Boolean),
        },
      });
      // preload bridge 已完成 Node 侧扫描与生成，这里只负责把快照交给网页编辑器。
      window.dispatchEvent(new CustomEvent('hyperframes:import-snapshot', { detail: snapshot }));
    } catch (error) {
      console.error('generate product project failed', error);
      window.alert(`商品项目生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGenerate}
      className="rounded-md border border-orange-300/40 bg-orange-300/10 px-2.5 py-[5px] text-[11px] font-medium text-orange-100 hover:bg-orange-300/20"
    >
      从商品文件夹生成视频
    </button>
  );
}
