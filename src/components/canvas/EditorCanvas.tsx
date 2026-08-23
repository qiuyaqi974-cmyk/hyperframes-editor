import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { fileToAsset } from '@/lib/assets';
import { formatTime } from '@/lib/animation';
import BlockRenderer from '@/components/blocks/BlockRenderer';

/**
 * 实时预览画布。
 *
 * 合成永远按 1920×1080 的逻辑坐标编排，屏幕上只是等比缩放显示，
 * 这样参数面板里的数字与最终输出一一对应，不会"编辑时对、导出时歪"。
 */
export default function EditorCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewScale, setViewScale] = useState(0.3);
  const [dropping, setDropping] = useState(false);

  const canvas = useEditorStore((s) => s.canvas);
  const blocks = useEditorStore((s) => s.blocks);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedId = useEditorStore((s) => s.selectedId);
  const showGhosts = useEditorStore((s) => s.showGhosts);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const selectBlock = useEditorStore((s) => s.selectBlock);
  const addAsset = useEditorStore((s) => s.addAsset);
  const addBlockFromAsset = useEditorStore((s) => s.addBlockFromAsset);

  /* 自适应缩放 */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const pad = 48;
      const w = el.clientWidth - pad;
      const h = el.clientHeight - pad;
      setViewScale(Math.max(0.05, Math.min(w / canvas.width, h / canvas.height)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvas.width, canvas.height]);

  /* 拖放素材直接落到画布 */
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDropping(false);
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const asset = await fileToAsset(file);
        if (!asset) continue;
        addAsset(asset);
        addBlockFromAsset(asset);
      }
    },
    [addAsset, addBlockFromAsset],
  );

  // 编辑态才显示幽灵；播放时严格按时间窗口出画，所见即所得
  const ghost = showGhosts && !isPlaying;
  const ordered = [...blocks].sort((a, b) => a.layer - b.layer);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#0e1014]">
      {/* 画布信息条 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-stroke px-4 text-[11px] text-ink-faint">
        <div className="flex items-center gap-3">
          <span className="rounded bg-panel-3 px-2 py-[2px] font-mono">
            {canvas.width}×{canvas.height}
          </span>
          <span>{Math.round(viewScale * 100)}%</span>
          <span className="text-ink-faint/60">·</span>
          <span>{blocks.length} 个积木</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono tabular-nums text-ink-dim">{formatTime(currentTime)}</span>
          {isPlaying && (
            <span className="flex items-center gap-1 text-accent">
              <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-accent" />
              播放中
            </span>
          )}
        </div>
      </div>

      <div
        ref={wrapRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onPointerDown={() => selectBlock(null)}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        {/* 舞台 */}
        <div
          className="relative shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
          style={{
            width: canvas.width * viewScale,
            height: canvas.height * viewScale,
          }}
        >
          <div
            data-hf-stage
            style={{
              width: canvas.width,
              height: canvas.height,
              background: canvas.background,
              transform: `scale(${viewScale})`,
              transformOrigin: 'top left',
              position: 'absolute',
              overflow: 'hidden',
            }}
          >
            {ordered.map((b) => (
              <BlockRenderer
                key={b.id}
                block={b}
                time={currentTime}
                canvas={canvas}
                viewScale={viewScale}
                selected={b.id === selectedId}
                ghost={ghost}
              />
            ))}
          </div>
        </div>

        {/* 空状态 */}
        {blocks.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
            <p className="text-[13px] text-ink-dim">点击左侧积木开始搭建</p>
            <p className="text-[11px] text-ink-faint">也可以把图片 / MP4 直接拖进来</p>
          </div>
        )}

        {/* 拖放高亮 */}
        {dropping && (
          <div className="pointer-events-none absolute inset-3 rounded-lg border-2 border-dashed border-accent bg-accent-soft" />
        )}
      </div>
    </div>
  );
}
