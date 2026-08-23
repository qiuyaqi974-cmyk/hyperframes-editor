import { useEffect, useRef, useState } from 'react';
import type { EvaluatedFrame, ScrollStoryBlockData } from '@/types';

interface Props {
  block: ScrollStoryBlockData;
  frame: EvaluatedFrame;
}

const FONT =
  "'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";

/**
 * 滚动故事积木：一段文字按时间匀速上滚。
 *
 * 关键：滚动偏移 = frame.localTime * speed，完全由播放头时间决定，
 * 而不是用 CSS animation 自跑——这样拖播放头 / 逐帧 / 将来导出，
 * 每一帧的滚动位置都确定性一致，不会漂移。
 * 文字真实高度用 ResizeObserver 量出来（只测量、不驱动动画）。
 */
export default function ScrollStoryBlock({ block, frame }: Props) {
  const { props } = block;
  const innerRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState(0);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setContentH(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.text, props.fontSize, props.fontWeight, props.lineHeight, props.width, props.bg]);

  const maxScroll = Math.max(0, contentH - props.height);
  const offset = Math.min(maxScroll, Math.max(0, frame.localTime * props.speed));

  return (
    <div
      style={{
        width: props.width,
        height: props.height,
        overflow: 'hidden',
        background: props.bg || 'transparent',
        borderRadius: 12,
        opacity: props.opacity * frame.opacity,
        boxSizing: 'border-box',
        display: 'block',
      }}
    >
      <div
        ref={innerRef}
        style={{
          transform: `translateY(${-offset}px)`,
          padding: '14px 18px',
          fontSize: props.fontSize,
          color: props.color,
          fontWeight: props.fontWeight,
          lineHeight: props.lineHeight,
          textAlign: props.align,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: FONT,
          willChange: 'transform',
        }}
      >
        {props.text || ' '}
      </div>
    </div>
  );
}
