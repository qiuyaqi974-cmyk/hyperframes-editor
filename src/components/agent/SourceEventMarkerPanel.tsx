import { useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import type { ExternalMediaSource, SourceEventMarkerKind } from '@/types';

interface Props {
  source: ExternalMediaSource;
  start: number;
  end: number;
  onSelect: (start: number, end: number) => void;
  onMessage: (message: string) => void;
}

function clock(seconds: number) {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.floor(Math.max(0, seconds) % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const kindLabel: Record<SourceEventMarkerKind, string> = { action: '动作', highlight: '重点保留', exclude: '明确不要' };

export default function SourceEventMarkerPanel({ source, start, end, onSelect, onMessage }: Props) {
  const updateSourceMedia = useEditorStore((state) => state.updateSourceMedia);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<SourceEventMarkerKind>('action');
  const markers = source.eventMarkers ?? [];
  const timelineLocked = Boolean(source.roughCutPlan?.appliedBlockIds?.length);

  const addMarker = () => {
    const text = label.trim();
    if (!text || end - start < 0.1) return;
    if (timelineLocked) {
      onMessage('请先撤销已追加的粗剪，再修改动作标记。');
      return;
    }
    const marker = {
      id: `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      label: text,
      start,
      end,
      kind,
      createdAt: new Date().toISOString(),
      visualConfirmed: true as const,
    };
    updateSourceMedia(source.id, { eventMarkers: [...markers, marker].sort((a, b) => a.start - b.start), roughCutPlan: undefined });
    setLabel('');
    onMessage(`已记录“${text}”动作区间；请重新生成粗剪候选以合并这项人工决定。`);
  };

  const removeMarker = (id: string) => {
    if (timelineLocked) {
      onMessage('请先撤销已追加的粗剪，再删除动作标记。');
      return;
    }
    updateSourceMedia(source.id, { eventMarkers: markers.filter((marker) => marker.id !== id), roughCutPlan: undefined });
    onMessage('已删除动作标记；粗剪候选需要重新生成。');
  };

  return <div className="rounded-md border border-fuchsia-300/20 bg-fuchsia-300/[0.035] p-2">
    <div className="mb-1.5"><h4 className="text-[10px] font-semibold text-fuchsia-100">无台词动作标记</h4><p className="mt-0.5 text-[8.5px] leading-relaxed text-ink-faint">先用上方入点/出点圈定你亲眼确认的动作，再保存。系统不会全片抽帧猜动作。</p></div>
    <div className="grid grid-cols-[0.8fr_1fr_auto] gap-1.5">
      <select value={kind} onChange={(event) => setKind(event.target.value as SourceEventMarkerKind)} disabled={timelineLocked} className="min-w-0 rounded border border-stroke bg-panel px-1.5 py-1 text-[9px] text-ink disabled:opacity-40"><option value="action">普通动作</option><option value="highlight">重点保留</option><option value="exclude">明确不要</option></select>
      <input value={label} onChange={(event) => setLabel(event.target.value)} disabled={timelineLocked} placeholder="例如：下锅、翻炒、成品特写" className="min-w-0 rounded border border-stroke bg-panel px-1.5 py-1 text-[9px] text-ink outline-none disabled:opacity-40" />
      <button type="button" onClick={addMarker} disabled={!label.trim() || end - start < 0.1 || timelineLocked} className="rounded bg-fuchsia-600 px-2 py-1 text-[9px] text-white disabled:opacity-40">保存 {clock(start)}–{clock(end)}</button>
    </div>
    {markers.length > 0 && <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">{markers.map((marker) => <div key={marker.id} className="flex items-center gap-1.5 rounded border border-stroke bg-panel/60 px-1.5 py-1"><button type="button" onClick={() => onSelect(marker.start, marker.end)} className="shrink-0 font-mono text-[8px] text-cyan-200">{clock(marker.start)}–{clock(marker.end)}</button><span className="min-w-0 flex-1 truncate text-[8.5px] text-ink-dim">{marker.label}</span><span className={`shrink-0 rounded px-1 py-0.5 text-[7.5px] ${marker.kind === 'highlight' ? 'bg-emerald-300/10 text-emerald-200' : marker.kind === 'exclude' ? 'bg-red-300/10 text-red-200' : 'bg-fuchsia-300/10 text-fuchsia-100'}`}>{kindLabel[marker.kind]}</span><button type="button" onClick={() => removeMarker(marker.id)} disabled={timelineLocked} className="text-[8px] text-ink-faint disabled:opacity-40">删除</button></div>)}</div>}
  </div>;
}
