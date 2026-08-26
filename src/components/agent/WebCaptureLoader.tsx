import { useState } from 'react';
import { useEditorStore } from '@/store/editorStore';

interface CapturedAsset {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  size: number;
}

interface CaptureResponse {
  assets?: CapturedAsset[];
  videos?: CapturedAsset[];
  error?: string;
}

/**
 * 网页素材采集入口（移植自 Remotion 生产线的网页截图工具）：
 * 输入网址 → 服务端无头浏览器采集 首屏/整页长图/关键词定位截图 → 直接进素材库。
 * 采集完成后可用「自动匹配到字幕」把素材对位到口播场景。
 */
export default function WebCaptureLoader() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const handleCapture = async () => {
    if (busy) return;
    const url = window.prompt('网页地址（http/https/file）', 'https://');
    if (!url || url === 'https://') return;
    const keywordInput = window.prompt('关键词定位截图（逗号分隔，可留空）', '');
    if (keywordInput === null) return;
    const keywords = keywordInput.split(/[,，]/).map((k) => k.trim()).filter(Boolean);
    const motionInput = window.prompt('连拍录屏秒数（0-15，0 或留空不录；录网页里的动态演示）', '0');
    if (motionInput === null) return;
    const motionSeconds = Math.max(0, Math.min(15, Number(motionInput) || 0));

    setBusy(true);
    setStatus(motionSeconds > 0 ? '正在采集截图 + 录屏…' : '正在打开无头浏览器采集…');
    try {
      const response = await fetch('/api/capture/web', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          keywords,
          ...(motionSeconds > 0 ? { motion: { seconds: motionSeconds, keyword: keywords[0] } } : {}),
        }),
      });
      const payload = (await response.json()) as CaptureResponse;
      if (!response.ok) {
        throw new Error(payload.error || `采集失败（HTTP ${response.status}）`);
      }
      const addAsset = useEditorStore.getState().addAsset;
      const all = [...(payload.assets ?? []), ...(payload.videos ?? [])];
      let added = 0;
      for (const asset of all) {
        addAsset({
          id: `webcap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: asset.name.replace(/\.[^.]+$/, ''),
          kind: asset.name.endsWith('.mp4') ? 'video' : 'image',
          url: asset.dataUrl,
          width: asset.width,
          height: asset.height,
          size: asset.size,
        });
        added += 1;
      }
      if (!added) throw new Error('服务端没有返回任何素材');
      const videoCount = payload.videos?.length ?? 0;
      setStatus(
        `已采集 ${payload.assets?.length ?? 0} 张截图${videoCount ? ` + ${videoCount} 段录屏` : ''}进素材库，可用「自动匹配到字幕」对位。`,
      );
    } catch (error) {
      setStatus(`采集失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleCapture}
        disabled={busy}
        className="w-full rounded-md border border-lime-300/40 bg-lime-300/10 px-2.5 py-[6px] text-[11px] font-medium text-lime-100 text-left hover:bg-lime-300/20 disabled:opacity-50"
      >
        {busy ? '采集中…' : '网页截图进素材库'}
      </button>
      {status && (
        <span className="text-[10px] leading-relaxed text-ink-faint" title={status}>
          {status}
        </span>
      )}
    </span>
  );
}
