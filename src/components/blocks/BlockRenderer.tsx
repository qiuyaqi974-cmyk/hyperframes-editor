import { useRef } from 'react';
import type { Block, CanvasConfig } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';
import { evaluateLayout, BlockContent } from '@/render/blockView';

interface Props {
  block: Block;
  time: number;
  canvas: CanvasConfig;
  /** 画布显示缩放（合成坐标 → 屏幕像素） */
  viewScale: number;
  selected: boolean;
  /** 编辑态：超窗口的积木以幽灵态显示 */
  ghost: boolean;
}

/**
 * 编辑器画布的积木壳层：在共享渲染层（blockView）之上，
 * 只叠加编辑交互——选中、拖拽、缩放。画面本身的求值与内容
 * 全部来自与导出播放器相同的实现。
 *
 * 每个积木都带上 data-block / data-start / data-duration —— 与 HyperFrames
 * 「DOM 用 data-* 声明时序」的契约同构。
 */
export default function BlockRenderer({
  block,
  time,
  canvas,
  viewScale,
  selected,
  ghost,
}: Props) {
  const selectBlock = useUIStore((s) => s.selectBlock);
  const moveBlock = useEditorStore((s) => s.moveBlock);
  const updateProps = useEditorStore((s) => s.updateProps);
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const resize = useRef<{ px: number; py: number; width: number; height: number } | null>(null);

  const layout = evaluateLayout(block, time, canvas, ghost);

  if (!layout.show) return null;

  const isBackground = block.type === 'video' && block.props.background;
  const outOfWindow = !layout.frame.active;

  // 文本型积木（Text / Subtitle）按内容自适应高度、不应用 scale
  const isTextLike = block.type === 'text' || block.type === 'subtitle';

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    selectBlock(block.id);
    if (block.locked || isBackground) return;
    drag.current = {
      ox: block.position.x,
      oy: block.position.y,
      px: e.clientX,
      py: e.clientY,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (resize.current) {
      const dx = (e.clientX - resize.current.px) / viewScale;
      const dy = (e.clientY - resize.current.py) / viewScale;
      const ratioDelta = (dx / Math.max(1, resize.current.width) + dy / Math.max(1, resize.current.height)) / 2;
      const ratio = Math.max(0.05, 1 + ratioDelta);
      updateProps(block.id, {
        width: Math.round(resize.current.width * ratio),
        height: Math.round(resize.current.height * ratio),
      });
      return;
    }
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.px) / viewScale;
    const dy = (e.clientY - drag.current.py) / viewScale;
    moveBlock(block.id, {
      x: Math.round(drag.current.ox + dx),
      y: Math.round(drag.current.oy + dy),
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    drag.current = null;
    resize.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const beginResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (block.locked || isBackground || isTextLike) return;
    resize.current = { px: e.clientX, py: e.clientY, width: layout.boxWidth, height: layout.boxHeight };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  return (
    <div
      data-block={block.id}
      data-type={block.type}
      data-start={block.start}
      data-duration={block.duration}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        ...layout.wrapStyle,
        cursor: block.locked || isBackground ? 'default' : 'move',
      }}
    >
      <BlockContent block={block} frame={layout.frame} width={layout.boxWidth} height={layout.boxHeight} />

      {selected && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            outline: `${Math.max(1.5, 2 / viewScale)}px solid #5b8cff`,
            outlineOffset: `${4 / viewScale}px`,
          }}
        >
          <div
            className="absolute whitespace-nowrap rounded bg-accent px-2 py-[2px] font-medium text-white"
            style={{
              fontSize: 12 / viewScale,
              top: -22 / viewScale,
              left: 0,
              paddingInline: 6 / viewScale,
            }}
          >
            {block.name}
            {outOfWindow && ' · 不在时间窗口'}
          </div>
        </div>
      )}
      {selected && !isTextLike && !isBackground && !block.locked && (
        <button
          type="button"
          aria-label="拖动缩放"
          title="拖动缩放"
          onPointerDown={beginResize}
          className="absolute bottom-0 right-0 z-30 h-7 w-7 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-full border-2 border-white bg-accent shadow-lg"
          style={{ width: 18 / viewScale, height: 18 / viewScale }}
        />
      )}
    </div>
  );
}
