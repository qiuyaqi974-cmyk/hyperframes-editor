import { useEffect, useRef, useState } from 'react';
import type { Block } from '@/types';
import { useDuration, useEditorStore } from '@/store/editorStore';
import { formatTime } from '@/lib/animation';
import { BLOCK_COLOR } from '@/lib/blockFactory';

const TRACK_LABEL_W = 148;
const ROW_H = 30;

type DragMode = 'move' | 'trim-start' | 'trim-end';

export default function Timeline() {
  const laneRef = useRef<HTMLDivElement>(null);
  const [laneW, setLaneW] = useState(800);

  const blocks = useEditorStore((s) => s.blocks);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const loopPlayback = useEditorStore((s) => s.loopPlayback);
  const showGhosts = useEditorStore((s) => s.showGhosts);
  const selectedId = useEditorStore((s) => s.selectedId);
  const scenes = useEditorStore((s) => s.scenes);
  const narration = useEditorStore((s) => s.narration);

  const setTime = useEditorStore((s) => s.setTime);
  const togglePlay = useEditorStore((s) => s.togglePlay);
  const toggleLoop = useEditorStore((s) => s.toggleLoop);
  const toggleGhosts = useEditorStore((s) => s.toggleGhosts);
  const selectBlock = useEditorStore((s) => s.selectBlock);
  const setTiming = useEditorStore((s) => s.setTiming);

  const total = useDuration();
  const pxPerSec = laneW / total;

  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const measure = () => setLaneW(Math.max(200, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- 播放头 seek ---------- */
  const scrubbing = useRef(false);

  const seekFromEvent = (clientX: number) => {
    const el = laneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = (clientX - rect.left) / pxPerSec;
    setTime(Math.min(total, Math.max(0, t)));
  };

  useEffect(() => {
    const move = (e: PointerEvent) => scrubbing.current && seekFromEvent(e.clientX);
    const up = () => (scrubbing.current = false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  /* ---------- clip 拖动 / 裁剪 ---------- */
  const clipDrag = useRef<{
    id: string;
    mode: DragMode;
    x: number;
    start: number;
    duration: number;
  } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = clipDrag.current;
      if (!d) return;
      const delta = (e.clientX - d.x) / pxPerSec;
      if (d.mode === 'move') {
        setTiming(d.id, Math.max(0, d.start + delta), d.duration);
      } else if (d.mode === 'trim-start') {
        const ns = Math.max(0, Math.min(d.start + d.duration - 0.2, d.start + delta));
        setTiming(d.id, ns, d.duration - (ns - d.start));
      } else {
        setTiming(d.id, d.start, Math.max(0.2, d.duration + delta));
      }
    };
    const up = () => (clipDrag.current = null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  const beginClipDrag = (e: React.PointerEvent, block: Block, mode: DragMode) => {
    e.stopPropagation();
    selectBlock(block.id);
    clipDrag.current = {
      id: block.id,
      mode,
      x: e.clientX,
      start: block.start,
      duration: block.duration,
    };
  };

  /* ---------- 刻度 ---------- */
  const tickStep = total <= 8 ? 0.5 : total <= 20 ? 1 : 2;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 0.0001; t += tickStep) ticks.push(Number(t.toFixed(2)));

  // SRT 字幕已汇总在“场景”轨，不再为每一句单独占一整行。
  const ordered = blocks.filter((block) => block.source !== 'srt').sort((a, b) => b.layer - a.layer);

  return (
    <section className="flex h-[248px] shrink-0 flex-col border-t border-stroke bg-panel">
      {/* 传输控制 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-stroke px-3">
        <button
          onClick={() => setTime(0)}
          title="回到开头"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-dim hover:bg-white/5 hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 5h2v14H6zM20 5v14l-11-7z" />
          </svg>
        </button>
        <button
          onClick={togglePlay}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-white transition-transform hover:scale-105"
          title="空格 播放 / 暂停"
        >
          {isPlaying ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 4v16l13-8z" />
            </svg>
          )}
        </button>

        <span className="ml-1 font-mono text-[12px] tabular-nums text-ink">
          {formatTime(currentTime)}
        </span>
        <span className="font-mono text-[11px] text-ink-faint">/ {formatTime(total)}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <TogglePill active={loopPlayback} onClick={toggleLoop} label="循环" />
          <TogglePill active={showGhosts} onClick={toggleGhosts} label="幽灵层" hint="编辑时显示不在时间窗口内的积木" />
        </div>
      </div>

      {/* 轨道区 */}
      <div className="flex min-h-0 flex-1">
        {/* 轨道名 */}
        <div
          className="shrink-0 overflow-hidden border-r border-stroke"
          style={{ width: TRACK_LABEL_W }}
        >
          <div className="h-6 border-b border-stroke bg-panel-2 px-3 text-[10px] leading-6 text-ink-faint">
            TRACKS
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 248 - 44 - 24 }}>
            {scenes.length > 0 && (
              <div style={{ height: ROW_H }} className="flex items-center gap-2 border-b border-stroke/60 px-3 text-[11.5px] text-cyan-300">
                <span className="h-[7px] w-[7px] rounded-sm bg-cyan-400" />
                <span>场景 · {scenes.length}</span>
              </div>
            )}
            {narration && (
              <div style={{ height: ROW_H }} className="flex items-center gap-2 border-b border-stroke/60 px-3 text-[11.5px] text-emerald-300">
                <span className="h-[7px] w-[7px] rounded-sm bg-emerald-400" />
                <span className="truncate">配音 · {narration.name}</span>
              </div>
            )}
            {ordered.map((b) => (
              <div
                key={b.id}
                onClick={() => selectBlock(b.id)}
                style={{ height: ROW_H }}
                className={`flex cursor-pointer items-center gap-2 border-b border-stroke/60 px-3 text-[11.5px] ${
                  b.id === selectedId ? 'bg-accent-soft text-ink' : 'text-ink-dim hover:bg-white/5'
                }`}
              >
                <span
                  className="h-[7px] w-[7px] shrink-0 rounded-sm"
                  style={{ background: BLOCK_COLOR[b.type] }}
                />
                <span className="truncate">{b.name}</span>
              </div>
            ))}
            {ordered.length === 0 && scenes.length === 0 && !narration && (
              <div className="px-3 py-3 text-[11px] text-ink-faint">暂无轨道</div>
            )}
          </div>
        </div>

        {/* 时间区 */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {/* 标尺 */}
          <div
            className="relative h-6 cursor-pointer border-b border-stroke bg-panel-2"
            onPointerDown={(e) => {
              scrubbing.current = true;
              seekFromEvent(e.clientX);
            }}
          >
            <div ref={laneRef} className="absolute inset-0">
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full border-l border-stroke/70"
                  style={{ left: t * pxPerSec }}
                >
                  <span className="ml-1 font-mono text-[9px] leading-6 text-ink-faint">
                    {t.toFixed(t % 1 === 0 ? 0 : 1)}s
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* clip 行 */}
          <div className="relative overflow-y-auto" style={{ maxHeight: 248 - 44 - 24 }}>
            {ticks.map((t) => (
              <div
                key={`g${t}`}
                className="pointer-events-none absolute top-0 h-full border-l border-stroke/30"
                style={{ left: t * pxPerSec }}
              />
            ))}

            {scenes.length > 0 && (
              <div style={{ height: ROW_H }} className="relative border-b border-stroke/40">
                {scenes.map((scene) => (
                  <button
                    key={scene.id}
                    onClick={() => setTime(scene.start)}
                    title={scene.text}
                    style={{ left: scene.start * pxPerSec, width: Math.max(5, scene.duration * pxPerSec) }}
                    className="absolute top-[4px] h-[22px] overflow-hidden rounded border border-cyan-400/70 bg-cyan-400/20 px-1 text-left text-[9px] text-cyan-200 hover:bg-cyan-400/30"
                  >
                    {scene.index}
                  </button>
                ))}
              </div>
            )}

            {narration && (
              <div style={{ height: ROW_H }} className="relative border-b border-stroke/40">
                <div
                  style={{ left: 0, width: Math.max(6, narration.duration * pxPerSec) }}
                  className="absolute top-[4px] flex h-[22px] items-center overflow-hidden rounded border border-emerald-400/70 bg-emerald-400/20 px-2 text-[9px] text-emerald-200"
                >
                  配音 {narration.duration.toFixed(1)}s
                </div>
              </div>
            )}

            {ordered.map((b) => {
              const left = b.start * pxPerSec;
              const width = Math.max(6, b.duration * pxPerSec);
              const color = BLOCK_COLOR[b.type];
              const animW =
                b.animation.type === 'none'
                  ? 0
                  : Math.min(width, (b.animation.delay + b.animation.duration) * pxPerSec);
              const active = b.id === selectedId;
              return (
                <div
                  key={b.id}
                  style={{ height: ROW_H }}
                  className="relative border-b border-stroke/40"
                >
                  <div
                    onPointerDown={(e) => beginClipDrag(e, b, 'move')}
                    onDoubleClick={() => setTime(b.start)}
                    title="双击跳到入点"
                    style={{
                      left,
                      width,
                      background: `${color}2e`,
                      borderColor: active ? '#5b8cff' : `${color}80`,
                      opacity: b.visible ? 1 : 0.4,
                    }}
                    className="group absolute top-[4px] flex h-[22px] cursor-grab items-center overflow-hidden rounded border active:cursor-grabbing"
                  >
                    {/* 入场动画区段 */}
                    {animW > 0 && (
                      <div
                        className="pointer-events-none absolute left-0 top-0 h-full"
                        style={{
                          width: animW,
                          background: `repeating-linear-gradient(45deg, ${color}40 0 5px, transparent 5px 10px)`,
                        }}
                      />
                    )}
                    <span
                      className="pointer-events-none relative z-10 truncate px-2 text-[10px] font-medium"
                      style={{ color }}
                    >
                      {b.name}
                    </span>
                    {/* 裁剪把手 */}
                    <span
                      onPointerDown={(e) => beginClipDrag(e, b, 'trim-start')}
                      className="absolute left-0 top-0 h-full w-[6px] cursor-ew-resize bg-white/0 hover:bg-white/30"
                    />
                    <span
                      onPointerDown={(e) => beginClipDrag(e, b, 'trim-end')}
                      className="absolute right-0 top-0 h-full w-[6px] cursor-ew-resize bg-white/0 hover:bg-white/30"
                    />
                  </div>
                </div>
              );
            })}

            {ordered.length === 0 && scenes.length === 0 && !narration && (
              <div className="px-4 py-4 text-[11px] text-ink-faint">
                添加积木后，这里会出现可拖动的时间片段
              </div>
            )}
          </div>

          {/* 播放头 */}
          <div
            className="pointer-events-none absolute top-0 z-20 h-full"
            style={{ left: currentTime * pxPerSec }}
          >
            <div className="h-full w-[1.5px] bg-accent" />
            <div className="absolute -left-[5px] top-0 h-[9px] w-[12px] rounded-sm bg-accent" />
          </div>
        </div>
      </div>
    </section>
  );
}

function TogglePill({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={`rounded-md border px-2 py-[3px] text-[10.5px] transition-colors ${
        active
          ? 'border-accent/50 bg-accent-soft text-accent'
          : 'border-stroke bg-panel-3 text-ink-faint hover:text-ink-dim'
      }`}
    >
      {label}
    </button>
  );
}
