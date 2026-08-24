import { useEffect, useState } from 'react';
import type { AssetInsight } from '@/lib/agent/assetAnalyzer';

export default function AssetInsightExportButton() {
  const [insights, setInsights] = useState<AssetInsight[]>([]);
  useEffect(() => {
    const handleInsights = (event: Event) => setInsights((event as CustomEvent<AssetInsight[]>).detail ?? []);
    window.addEventListener('hyperframes:asset-insights', handleInsights);
    return () => window.removeEventListener('hyperframes:asset-insights', handleInsights);
  }, []);
  const handleExport = () => {
    if (!insights.length) return window.alert('暂无AssetInsight。请先完成商品文件夹生成。');
    const url = URL.createObjectURL(new Blob([JSON.stringify(insights, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'asset-insights.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <button type="button" onClick={handleExport} className="rounded-md border border-orange-300/40 bg-orange-300/10 px-2.5 py-[5px] text-[11px] font-medium text-orange-100 hover:bg-orange-300/20">导出当前AssetInsights</button>;
}
