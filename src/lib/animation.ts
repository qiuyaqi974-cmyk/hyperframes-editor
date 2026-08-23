import type { AnimationSpec, Block, EasingName, EvaluatedFrame } from '@/types';

/**
 * 确定性求值器。
 *
 * 这是整个编辑器的心脏，也是与 HyperFrames 对齐的地方：
 * 画面完全由 `(block, t)` 决定，不依赖任何"正在播放中"的隐式状态。
 * 所以拖动播放头、暂停、跳帧、将来离屏逐帧渲染，结果都一模一样。
 *
 * 注意：这里刻意 **没有** 用 CSS transition / 自跑的 keyframes——
 * 那类动画一旦 seek 就会漂移，无法帧精确导出。
 */

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const EASINGS: Record<EasingName, (p: number) => number> = {
  linear: (p) => p,
  easeOut: (p) => 1 - Math.pow(1 - p, 3),
  easeInOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  // 衰减正弦近似的弹簧，纯函数、可 seek
  spring: (p) => {
    if (p >= 1) return 1;
    const c = 2 * Math.PI / 0.55;
    return 1 - Math.pow(2, -9 * p) * Math.cos(p * c * 0.55 * 1.6);
  },
};

export function easeWith(name: EasingName, p: number): number {
  return (EASINGS[name] ?? EASINGS.linear)(clamp(p, 0, 1));
}

/** 入场动画进度：0 = 动画起点，1 = 落位 */
function entryProgress(anim: AnimationSpec, localTime: number): number {
  if (anim.type === 'none' || anim.duration <= 0) return 1;
  const raw = (localTime - anim.delay) / anim.duration;
  return easeWith(anim.easing, clamp(raw, 0, 1));
}

function slideOffset(anim: AnimationSpec, p: number): { dx: number; dy: number } {
  const remain = 1 - p;
  const d = anim.distance * remain;
  switch (anim.direction) {
    case 'left':
      return { dx: -d, dy: 0 };
    case 'right':
      return { dx: d, dy: 0 };
    case 'up':
      return { dx: 0, dy: -d };
    case 'down':
      return { dx: 0, dy: d };
    default:
      return { dx: 0, dy: 0 };
  }
}

/**
 * 求出 block 在全局时间 t 的画面状态。
 * @param block 积木
 * @param time  全局播放头时间（秒）
 * @param isolate 编辑态下即使超出时间窗口也保持可见（半透明幽灵），便于摆位
 */
export function evaluateBlock(block: Block, time: number, isolate = false): EvaluatedFrame {
  const localTime = time - block.start;
  const inWindow = localTime >= 0 && localTime <= block.duration;

  if (!inWindow && !isolate) {
    return { active: false, opacity: 0, dx: 0, dy: 0, scale: 1, localTime, progress: 0 };
  }

  const anim = block.animation;
  const p = entryProgress(anim, Math.max(0, localTime));

  let opacity = 1;
  let dx = 0;
  let dy = 0;
  let scale = 1;

  switch (anim.type) {
    case 'fade':
      opacity = p;
      break;
    case 'slide': {
      const off = slideOffset(anim, p);
      dx = off.dx;
      dy = off.dy;
      // slide 天然带一点淡入，否则元素会硬生生飞进画面
      opacity = easeWith('easeOut', clamp(p * 1.4, 0, 1));
      break;
    }
    case 'scale':
      scale = anim.from + (1 - anim.from) * p;
      opacity = easeWith('easeOut', clamp(p * 1.6, 0, 1));
      break;
    case 'none':
    default:
      break;
  }

  return {
    active: inWindow,
    opacity: clamp(opacity, 0, 1),
    dx,
    dy,
    scale,
    localTime,
    progress: p,
  };
}

/** 时间轴总长度：最后一个 block 的出点，最少 6 秒 */
export function compositionDuration(blocks: Block[]): number {
  const end = blocks.reduce((max, b) => Math.max(max, b.start + b.duration), 0);
  return Math.max(6, Math.ceil(end * 2) / 2);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}
