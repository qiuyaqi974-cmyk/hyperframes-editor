import type { CursorBlockData, EvaluatedFrame } from '@/types';

interface Props { block: CursorBlockData; frame: EvaluatedFrame }

export default function CursorBlock({ block, frame }: Props) {
  const p = block.props;
  const motion = Math.min(1, Math.max(0, frame.localTime / Math.max(0.01, block.duration * 0.72)));
  const eased = 1 - Math.pow(1 - motion, 3);
  const dx = (p.endX - block.position.x) * eased;
  const dy = (p.endY - block.position.y) * eased;
  const clickTimes = p.action === 'double-click' ? [0.72, 0.88] : p.action === 'click' || p.action === 'drag' ? [0.78] : [];
  const localRatio = frame.localTime / Math.max(0.01, block.duration);
  const pulse = Math.max(0, ...clickTimes.map((t) => 1 - Math.abs(localRatio - t) / 0.11));
  return <div style={{ width: p.width, height: p.height, position: 'relative', transform: `translate(${dx}px,${dy}px)`, opacity: p.opacity * frame.opacity }}>
    {p.showTrail && <span style={{ position: 'absolute', left: 25, top: 27, width: 34 + 46 * pulse, height: 34 + 46 * pulse, transform: 'translate(-50%,-50%)', borderRadius: '50%', border: `5px solid ${p.clickColor}`, opacity: pulse * .85 }} />}
    <svg width="58" height="72" viewBox="0 0 58 72" style={{ position: 'absolute', left: 8, top: 5, filter: 'drop-shadow(0 5px 8px rgba(0,0,0,.35))' }}><path d="M7 5 L49 42 L31 44 L42 64 L29 70 L19 49 L7 61 Z" fill={p.cursorColor} stroke={p.outlineColor} strokeWidth="5" strokeLinejoin="round" /></svg>
    {p.action === 'drag' && motion > .08 && motion < 1 && <span style={{ position: 'absolute', left: 22, top: 22, width: 20, height: 20, borderRadius: '50%', background: p.clickColor, opacity: .75 }} />}
  </div>;
}
