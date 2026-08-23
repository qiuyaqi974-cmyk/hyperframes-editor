import type { EvaluatedFrame, SpotlightBlockData } from '@/types';

interface Props {
  block: SpotlightBlockData;
  frame: EvaluatedFrame;
}

/**
 * 聚光积木：在画面上挖一个亮洞，其余压暗，引导视线。
 * 纯展示组件，位置 / 入场动画 / 选中态由 BlockRenderer 统一套壳。
 * 染色半径、羽化、暗度都由 props 决定，时间驱动由通用入场动画处理。
 */
export default function SpotlightBlock({ block, frame }: Props) {
  const { props } = block;
  const r = Math.max(0, props.radius);
  const soft = Math.max(0, props.softness);
  const dim = Math.min(1, Math.max(0, props.dim));
  const inner = Math.max(0, r - soft);

  // 径向渐变：圆心透明（或轻微染色）→ 边缘羽化 → 外圈全暗
  const bg = `radial-gradient(circle at 50% 50%, ${props.tint} 0%, ${props.tint} ${inner}px, rgba(0,0,0,${dim}) ${r}px, rgba(0,0,0,${dim}) 100%)`;

  return (
    <div
      style={{
        width: props.width,
        height: props.height,
        background: bg,
        opacity: props.opacity * frame.opacity,
        display: 'block',
      }}
    />
  );
}
