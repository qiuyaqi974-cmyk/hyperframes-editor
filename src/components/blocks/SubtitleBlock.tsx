import type { EvaluatedFrame, SubtitleBlockData } from '@/types';

interface Props {
  block: SubtitleBlockData;
  frame: EvaluatedFrame;
}

const FONT =
  "'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";

/**
 * 字幕积木：底部居中的说明文字，带半透明底衬。
 * 文本型积木（与 Text 一样 auto 高度），由 BlockRenderer 按 maxWidth 定宽。
 */
export default function SubtitleBlock({ block, frame }: Props) {
  const { props } = block;

  return (
    <div style={{ width: props.maxWidth, opacity: props.opacity * frame.opacity }}>
      <div
        style={{
          display: 'inline-block',
          maxWidth: '100%',
          background: props.bg || 'transparent',
          color: props.color,
          fontSize: props.fontSize,
          fontWeight: props.fontWeight,
          letterSpacing: props.letterSpacing,
          lineHeight: props.lineHeight,
          textAlign: props.align,
          padding: `${props.paddingY}px ${props.paddingX}px`,
          borderRadius: 10,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: FONT,
          boxSizing: 'border-box',
        }}
      >
        {props.text || ' '}
      </div>
    </div>
  );
}
