import type { EvaluatedFrame, GlassUIBlockData } from '@/types';

interface Props {
  block: GlassUIBlockData;
  frame: EvaluatedFrame;
}

/**
 * 玻璃拟态 UI 积木：毛玻璃背景 + 描边。
 *
 * 注意：backdrop-filter 模糊的是画布中「位于其下方」的兄弟元素
 * （视频 / 图片等），所以它必须叠在背景内容之上才看得到磨砂效果。
 * 这一层模糊是浏览器实时合成的，导出时若需还原，可用离屏快照替代。
 */
export default function GlassUIBlock({ block, frame }: Props) {
  const { props } = block;

  return (
    <div
      style={{
        width: props.width,
        height: props.height,
        borderRadius: props.radius,
        background: props.tint,
        backdropFilter: `blur(${props.blur}px)`,
        WebkitBackdropFilter: `blur(${props.blur}px)`,
        border: `${props.borderWidth}px solid ${props.border}`,
        boxSizing: 'border-box',
        opacity: props.opacity * frame.opacity,
        display: 'block',
      }}
    />
  );
}
