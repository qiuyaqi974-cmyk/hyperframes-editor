import type { EvaluatedFrame, TextBlockData } from '@/types';

interface Props {
  block: TextBlockData;
  frame: EvaluatedFrame;
}

export default function TextBlock({ block, frame }: Props) {
  const { props } = block;

  return (
    <div
      style={{
        width: props.maxWidth,
        fontSize: props.fontSize,
        color: props.color,
        fontWeight: props.fontWeight,
        letterSpacing: props.letterSpacing,
        lineHeight: props.lineHeight,
        textAlign: props.align,
        opacity: props.opacity * frame.opacity,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily:
          "'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      }}
    >
      {props.text || ' '}
    </div>
  );
}
