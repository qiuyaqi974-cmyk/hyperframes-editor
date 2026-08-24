import { useRef, useState } from 'react';
import { resolveAssets } from '@/lib/assetResolver/assetResolver';

export default function AssetResolverLoader() {
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const insightInputRef = useRef<HTMLInputElement>(null);
  const [scenePlan, setScenePlan] = useState<unknown>(null);
  const [assetInsights, setAssetInsights] = useState<unknown[]>([]);
  const [status, setStatus] = useState('');

  const readJson = async (file: File | undefined) => (file ? JSON.parse(await file.text()) : null);
  const resolve = () => {
    if (!scenePlan) return setStatus('请先上传 scene-plan.json');
    if (!assetInsights.length) return setStatus('请先上传 asset-insights.json');
    const assets = assetInsights.map((item) => {
      const insight = item as Record<string, any>;
      return { id: insight.assetId, name: insight.name, kind: insight.kind, url: insight.url };
    });
    const result = resolveAssets({ scenePlan, assets, assetInsights });
    const blob = new Blob([JSON.stringify(result.scenePlan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'scene-plan-resolved.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`完成：匹配 ${result.matchedCount}，未匹配 ${result.unmatchedCount}`);
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => sceneInputRef.current?.click()} className="rounded-md border border-pink-300/40 bg-pink-300/10 px-2.5 py-[5px] text-[11px] font-medium text-pink-100 hover:bg-pink-300/20">上传ScenePlan</button>
      <input ref={sceneInputRef} type="file" accept=".json,application/json" className="hidden" onChange={async (event) => { setScenePlan(await readJson(event.target.files?.[0])); event.target.value = ''; }} />
      <button type="button" onClick={() => insightInputRef.current?.click()} className="rounded-md border border-pink-300/40 bg-pink-300/10 px-2.5 py-[5px] text-[11px] font-medium text-pink-100 hover:bg-pink-300/20">上传AssetInsights</button>
      <input ref={insightInputRef} type="file" accept=".json,application/json" className="hidden" onChange={async (event) => { const parsed = await readJson(event.target.files?.[0]) as unknown; const items = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && 'assets' in parsed && Array.isArray(parsed.assets) ? parsed.assets : []); setAssetInsights(items); event.target.value = ''; }} />
      <button type="button" onClick={resolve} className="rounded-md border border-pink-300/40 bg-pink-300/10 px-2.5 py-[5px] text-[11px] font-medium text-pink-100 hover:bg-pink-300/20">绑定素材测试</button>
      {status && <span className="text-[10px] text-ink-faint">{status}</span>}
    </span>
  );
}
