interface ElectronBridge {
  generateProductProject: (input: {
    folderPath?: string;
    productInfo?: {
      productName?: string;
      targetAudience?: string;
      sellingPoints?: string[];
    };
  }) => Promise<{ snapshot: unknown }>;
}

/** 通过 Electron preload bridge 调用 Node 商品文件夹 Agent；普通浏览器不直接访问本地路径。 */
export default function ProductProjectLoader() {
  const handleGenerate = async () => {
    console.log('click generate product project');
    const bridge = (window as Window & { hyperframesElectron?: ElectronBridge }).hyperframesElectron;
    console.log('electron bridge', bridge);
    if (!bridge) {
      alert('electron bridge missing');
      return;
    }
    const productName = window.prompt('商品名称', '便携榨汁杯') ?? '未知商品';
    const targetAudience = window.prompt('目标用户', '办公室女性、学生') ?? '普通消费者';
    const rawPoints = window.prompt('卖点（每行一个）', '小巧便携\n充电使用\n快速榨汁\n清洗方便') ?? '';

    try {
      await bridge.generateProductProject({
        productInfo: {
          productName: productName || '未知商品',
          targetAudience: targetAudience || '普通消费者',
          sellingPoints: rawPoints.split(/[\n,，、]/).map((point) => point.trim()).filter(Boolean),
        },
      });
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
