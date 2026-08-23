import type { CardBlockData, EvaluatedFrame } from '@/types';

interface Props {
  block: CardBlockData;
  frame: EvaluatedFrame;
}

export default function CardBlock({ block, frame }: Props) {
  const p = block.props;
  return (
    <div
      style={{
        width: p.width,
        height: p.height,
        boxSizing: 'border-box',
        padding: p.padding,
        borderRadius: p.radius,
        border: `1px solid ${p.border}`,
        background: p.bg,
        opacity: p.opacity * frame.opacity,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: p.align === 'center' ? 'center' : 'flex-start',
        textAlign: p.align,
        overflow: 'hidden',
      }}
    >
      {p.showAccent && (
        <span style={{ width: 64, height: 6, borderRadius: 999, background: p.accent, marginBottom: 24 }} />
      )}
      {p.eyebrow && (
        <div style={{ color: p.accent, fontSize: 18, fontWeight: 800, letterSpacing: 3, marginBottom: 14 }}>
          {p.eyebrow}
        </div>
      )}
      <div style={{ color: p.titleColor, fontSize: 48, lineHeight: 1.12, fontWeight: 800, whiteSpace: 'pre-wrap' }}>
        {p.title}
      </div>
      {p.body && (
        <div style={{ color: p.bodyColor, fontSize: 24, lineHeight: 1.55, marginTop: 20, whiteSpace: 'pre-wrap', maxWidth: '95%' }}>
          {p.body}
        </div>
      )}
    </div>
  );
}
