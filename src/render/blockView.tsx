import type { Block, CanvasConfig, EvaluatedFrame } from '@/types';
import { evaluateBlock } from '@/lib/animation';
import { resolveBox } from '@/lib/blockFactory';
import ImageBlock from '@/components/blocks/ImageBlock';
import TextBlock from '@/components/blocks/TextBlock';
import VideoBlock from '@/components/blocks/VideoBlock';
import SpotlightBlock from '@/components/blocks/SpotlightBlock';
import GlassUIBlock from '@/components/blocks/GlassUIBlock';
import CardBlock from '@/components/blocks/CardBlock';
import CursorBlock from '@/components/blocks/CursorBlock';
import ChartBlock from '@/components/blocks/ChartBlock';
import ScrollStoryBlock from '@/components/blocks/ScrollStoryBlock';
import SubtitleBlock from '@/components/blocks/SubtitleBlock';
import VoiceBlock from '@/components/blocks/VoiceBlock';

/**
 * 渲染共享层。
 *
 * 编辑器画布（BlockRenderer）和导出 HTML 播放器（HyperFramesPlayer）都通过
 * 这里的 evaluateLayout + BlockContent 把「时间 → 画面」落到 DOM 上，
 * 保证两边看到的是同一套实现，而不是各自手写一份渲染规则。
 */

export interface StageLayout {
  frame: EvaluatedFrame;
  /** 是否应该出现在画面上（visible 且在窗口内，或编辑态幽灵） */
  show: boolean;
  wrapStyle: React.CSSProperties;
  boxWidth: number;
  boxHeight: number;
}

export function evaluateLayout(
  block: Block,
  time: number,
  canvas: CanvasConfig,
  ghost = false,
): StageLayout {
  const frame = evaluateBlock(block, time, ghost);
  const box = resolveBox(block, canvas);

  const isTextLike = block.type === 'text' || block.type === 'subtitle';
  const propScale = isTextLike ? 1 : (block.props as { scale: number }).scale ?? 1;
  const rotation = block.type === 'image' ? block.props.rotation : 0;

  const inWindow = frame.active;
  const outOfWindow = !inWindow;

  return {
    frame,
    show: block.visible && (inWindow || ghost),
    boxWidth: box.width,
    boxHeight: box.height,
    wrapStyle: {
      position: 'absolute',
      left: box.x,
      top: box.y,
      width: isTextLike ? (block.props as { maxWidth: number }).maxWidth : box.width,
      height: isTextLike ? 'auto' : box.height,
      zIndex: block.layer + 1,
      transform: `translate(${frame.dx}px, ${frame.dy}px) scale(${propScale * frame.scale}) rotate(${rotation}deg)`,
      transformOrigin: 'center center',
      opacity: outOfWindow ? 0.18 : 1,
      willChange: 'transform, opacity',
    },
  };
}

export const BlockContent: React.FC<{
  block: Block;
  frame: EvaluatedFrame;
  width?: number;
  height?: number;
  /** voice 积木的呈现形态：编辑器内可交互，播放/导出时只读 */
  voiceMode?: 'edit' | 'view';
}> = ({ block, frame, width, height, voiceMode = 'edit' }) => (
  <>
    {block.type === 'image' && <ImageBlock block={block} frame={frame} />}
    {block.type === 'text' && <TextBlock block={block} frame={frame} />}
    {block.type === 'video' && <VideoBlock block={block} frame={frame} width={width ?? 0} height={height ?? 0} />}
    {block.type === 'spotlight' && <SpotlightBlock block={block} frame={frame} />}
    {block.type === 'glassui' && <GlassUIBlock block={block} frame={frame} />}
    {block.type === 'card' && <CardBlock block={block} frame={frame} />}
    {block.type === 'cursor' && <CursorBlock block={block} frame={frame} />}
    {block.type === 'chart' && <ChartBlock block={block} frame={frame} />}
    {block.type === 'scrollstory' && <ScrollStoryBlock block={block} frame={frame} />}
    {block.type === 'subtitle' && <SubtitleBlock block={block} frame={frame} />}
    {block.type === 'voice' && <VoiceBlock block={block} frame={frame} mode={voiceMode} />}
  </>
);
