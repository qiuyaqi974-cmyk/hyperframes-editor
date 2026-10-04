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
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState('https://');
  const [keywordInput, setKeywordInput] = useState('');
  const [motionSeconds, setMotionSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const handleCapture = async () => {
    if (busy) return;
    if (!url.trim() || url.trim() === 'https://') return setStatus('请输入完整网页地址。');
    const keywords = keywordInput.split(/[,，]/).map((k) => k.trim()).filter(Boolean);
    const captureSeconds = Math.max(0, Math.min(15, Number(motionSeconds) || 0));

    setBusy(true);
    setStatus(captureSeconds > 0 ? '正在采集截图 + 录屏…' : '正在打开无头浏览器采集…');
    try {
      const response = await fetch('/api/capture/web', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          keywords,
          ...(captureSeconds > 0 ? { motion: { seconds: captureSeconds, keyword: keywords[0] } } : {}),
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
        onClick={() => setExpanded((value) => !value)}
        disabled={busy}
        className="w-full rounded-md border border-lime-300/40 bg-lime-300/10 px-2.5 py-[6px] text-[11px] font-medium text-lime-100 text-left hover:bg-lime-300/20 disabled:opacity-50"
      >
        {busy ? '采集中…' : `网页截图进素材库 ${expanded ? '−' : '+'}`}
      </button>
      {expanded && (
        <span className="grid gap-1.5 rounded-md border border-stroke bg-panel-3/70 p-2">
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" className="rounded border border-stroke bg-panel px-2 py-1.5 text-[11px] text-ink outline-none focus:border-lime-300/50" />
          <input value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} placeholder="定位关键词，逗号分隔（可选）" className="rounded border border-stroke bg-panel px-2 py-1.5 text-[11px] text-ink outline-none focus:border-lime-300/50" />
          <label className="flex items-center justify-between gap-2 text-[10px] text-ink-faint">
            动态录屏秒数（0–15）
            <input type="number" min={0} max={15} value={motionSeconds} onChange={(event) => setMotionSeconds(Math.max(0, Math.min(15, Number(event.target.value) || 0)))} className="w-16 rounded border border-stroke bg-panel px-2 py-1 text-[11px] text-ink outline-none" />
          </label>
          <button type="button" onClick={handleCapture} disabled={busy || !url.trim() || url.trim() === 'https://'} className="rounded bg-lime-400 px-2.5 py-1.5 text-[11px] font-semibold text-[#102414] disabled:cursor-not-allowed disabled:opacity-40">开始采集</button>
        </span>
      )}
      {status && (
        <span className="text-[10px] leading-relaxed text-ink-faint" title={status}>
          {status}
        </span>
      )}
    </span>
  );
}
