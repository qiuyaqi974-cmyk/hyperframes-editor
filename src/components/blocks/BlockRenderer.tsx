import { useRef } from 'react';
import type { Block, CanvasConfig } from '@/types';
import { evaluateBlock } from '@/lib/animation';
import { resolveBox } from '@/lib/blockFactory';
import { useEditorStore } from '@/store/editorStore';
import ImageBlock from './ImageBlock';
import TextBlock from './TextBlock';
import VideoBlock from './VideoBlock';
import SpotlightBlock from './SpotlightBlock';
import GlassUIBlock from './GlassUIBlock';
import CardBlock from './CardBlock';
import CursorBlock from './CursorBlock';
import ChartBlock from './ChartBlock';
import ScrollStoryBlock from './ScrollStoryBlock';
import SubtitleBlock from './SubtitleBlock';

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
 * 统一套壳层：把「时间 → 画面」的求值结果落到 DOM 上。
 *
 * 每个积木都带上 data-block / data-start / data-duration —— 与 HyperFrames
 * 「DOM 用 data-* 声明时序」的契约同构，将来导出合成 HTML 时可直接沿用。
 */
export default function BlockRenderer({
  block,
  time,
  canvas,
  viewScale,
  selected,
  ghost,
}: Props) {
  const selectBlock = useEditorStore((s) => s.selectBlock);
  const moveBlock = useEditorStore((s) => s.moveBlock);
  const updateProps = useEditorStore((s) => s.updateProps);
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const resize = useRef<{ px: number; py: number; width: number; height: number } | null>(null);

  const frame = evaluateBlock(block, time, ghost);
  const box = resolveBox(block, canvas);

  if (!block.visible) return null;
  if (!frame.active && !ghost) return null;

  const isBackground = block.type === 'video' && block.props.background;
  const outOfWindow = !frame.active;

  // 文本型积木（Text / Subtitle）按内容自适应高度、不应用 scale
  const isTextLike = block.type === 'text' || block.type === 'subtitle';
  const propScale = isTextLike ? 1 : (block.props as { scale: number }).scale ?? 1;
  const rotation = block.type === 'image' ? block.props.rotation : 0;

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
    resize.current = { px: e.clientX, py: e.clientY, width: box.width, height: box.height };
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
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: isTextLike ? (block.props as { maxWidth: number }).maxWidth : box.width,
        height: isTextLike ? 'auto' : box.height,
        zIndex: block.layer + 1,
        transform: `translate(${frame.dx}px, ${frame.dy}px) scale(${propScale * frame.scale}) rotate(${rotation}deg)`,
        transformOrigin: 'center center',
        opacity: outOfWindow ? 0.18 : 1,
        cursor: block.locked || isBackground ? 'default' : 'move',
        willChange: 'transform, opacity',
      }}
    >
      {block.type === 'image' && <ImageBlock block={block} frame={frame} />}
      {block.type === 'text' && <TextBlock block={block} frame={frame} />}
      {block.type === 'video' && (
        <VideoBlock block={block} frame={frame} width={box.width} height={box.height} />
      )}
      {block.type === 'spotlight' && <SpotlightBlock block={block} frame={frame} />}
      {block.type === 'glassui' && <GlassUIBlock block={block} frame={frame} />}
      {block.type === 'card' && <CardBlock block={block} frame={frame} />}
      {block.type === 'cursor' && <CursorBlock block={block} frame={frame} />}
      {block.type === 'chart' && <ChartBlock block={block} frame={frame} />}
      {block.type === 'scrollstory' && <ScrollStoryBlock block={block} frame={frame} />}
      {block.type === 'subtitle' && <SubtitleBlock block={block} frame={frame} />}

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
