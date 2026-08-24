import type { ProjectSnapshot } from '@/types';
import type { AssetInsight } from '@/lib/agent/assetAnalyzer';
import { useState } from 'react';

interface ElectronBridge {
  generateProductProject: (input: {
    folderPath?: string;
    productInfo?: {
      productName?: string;
      targetAudience?: string;
      sellingPoints?: string[];
    };
  }) => Promise<{ snapshot: ProjectSnapshot; assetInsights?: AssetInsight[] }>;
}

/** 通过 Electron preload bridge 调用 Node 商品文件夹 Agent；普通浏览器不直接访问本地路径。 */
export default function ProductProjectLoader() {
  const [assetInsights, setAssetInsights] = useState<AssetInsight[]>([]);
  const exportInsights = () => {
    if (!assetInsights.length) {
      window.alert('暂无AssetInsight。请先完成商品文件夹生成。');
      return;
    }
    const blob = new Blob([JSON.stringify(assetInsights, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'asset-insights.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerate = async () => {
    console.log('1 click');
    console.log('click generate product project');
    const bridge = (window as Window & { hyperframesElectron?: ElectronBridge }).hyperframesElectron;
    console.log('2 bridge', bridge);
    console.log('electron bridge', bridge);
    if (!bridge) {
      alert('electron bridge missing');
      return;
    }
    try {
      console.log('3 calling ipc');
      const { snapshot, assetInsights } = await bridge.generateProductProject({
        productInfo: {
          productName: '未知商品',
          targetAudience: '普通消费者',
          sellingPoints: [],
        },
      });
      setAssetInsights(assetInsights ?? []);
      window.dispatchEvent(new CustomEvent('hyperframes:import-snapshot', { detail: snapshot }));
    } catch (error) {
      console.error(error);
      console.error('generate product project failed', error);
      window.alert(`商品项目生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={handleGenerate} className="rounded-md border border-orange-300/40 bg-orange-300/10 px-2.5 py-[5px] text-[11px] font-medium text-orange-100 hover:bg-orange-300/20">
        从商品文件夹生成视频
      </button>
      <button type="button" onClick={exportInsights} className="rounded-md border border-orange-300/40 bg-orange-300/10 px-2.5 py-[5px] text-[11px] font-medium text-orange-100 hover:bg-orange-300/20">
        导出素材分析结果
      </button>
    </span>
  );
}
