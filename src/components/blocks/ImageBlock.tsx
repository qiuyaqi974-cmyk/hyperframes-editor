import type { EvaluatedFrame, ImageBlockData } from '@/types';

interface Props {
  block: ImageBlockData;
  frame: EvaluatedFrame;
}

/**
 * 图片积木 —— 只负责"长什么样"。
 * 位置、入场动画、选中态由 BlockRenderer 统一套壳，保证所有积木行为一致。
 */
export default function ImageBlock({ block, frame }: Props) {
  const { props } = block;

  if (!props.src) {
    return (
      <div
        style={{ width: props.width, height: props.height, borderRadius: props.radius }}
        className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-white/25 bg-white/5"
      >
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <span className="text-[20px] text-white/45">图片占位</span>
        <span className="max-w-[80%] text-center text-[13px] leading-relaxed text-white/35">
          {props.visualPrompt || '在右侧上传图片'}
        </span>
      </div>
    );
  }

  return (
    <img
      src={props.src}
      alt={block.name}
      draggable={false}
      style={{
        width: props.width,
        height: props.height,
        borderRadius: props.radius,
        opacity: props.opacity * frame.opacity,
        objectFit: 'cover',
        display: 'block',
      }}
    />
  );
}
