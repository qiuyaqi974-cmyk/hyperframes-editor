import type { EvaluatedFrame, ChartBlockData } from '@/types';

interface Props { block: ChartBlockData; frame: EvaluatedFrame }
const FONT = "'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";

export default function ChartBlock({ block, frame }: Props) {
  const p = block.props, W = p.width, H = p.height;
  const values = p.data.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  const labels = (p.labels || '').split(',').map((s) => s.trim());
  const colors = [p.color, p.secondaryColor || '#38bdf8', '#f59e0b', '#f472b6', '#a78bfa'];
  const textColor = p.textColor || '#ffffff', unit = p.unit || '', max = Math.max(1, ...values);
  const title = p.title && <div style={{ color: textColor, fontSize: Math.min(24, H * 0.065), fontWeight: 700, marginBottom: 18 }}>{p.title}</div>;
  const shell: React.CSSProperties = { width: W, height: H, borderRadius: p.radius, background: p.bg || 'transparent', opacity: p.opacity * frame.opacity, boxSizing: 'border-box', overflow: 'hidden', fontFamily: FONT };

  if (p.type === 'progress') return <div style={{ ...shell, padding: 28, display: 'flex', flexDirection: 'column' }}>{title}<div style={{ display: 'grid', gap: 16, flex: 1, alignContent: 'center' }}>{values.map((v, i) => <div key={i}><div style={{ display: 'flex', justifyContent: 'space-between', color: textColor, fontSize: 16, marginBottom: 7 }}><span>{labels[i] || `数据 ${i + 1}`}</span>{p.showValues !== false && <strong>{v}{unit}</strong>}</div><div style={{ height: 14, borderRadius: 99, background: 'rgba(127,127,127,.18)', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, (v / max) * 100)}%`, height: '100%', background: `linear-gradient(90deg,${p.color},${p.secondaryColor || p.color})`, borderRadius: 99 }} /></div></div>)}</div></div>;

  if (p.type === 'donut') {
    const total = Math.max(1, values.reduce((a, b) => a + b, 0)); let offset = 0;
    const gradient = values.map((v, i) => { const from = offset; offset += (v / total) * 100; return `${colors[i % colors.length]} ${from}% ${offset}%`; }).join(',');
    return <div style={{ ...shell, padding: 28 }}>{title}<div style={{ display: 'flex', height: `calc(100% - ${p.title ? 50 : 0}px)`, alignItems: 'center', justifyContent: 'center', gap: 42 }}><div style={{ width: Math.min(W * .38, H * .58), aspectRatio: '1', borderRadius: '50%', background: `conic-gradient(${gradient || `${p.color} 0 100%`})`, display: 'grid', placeItems: 'center' }}><div style={{ width: '58%', height: '58%', borderRadius: '50%', background: p.bg || '#111', display: 'grid', placeItems: 'center', color: textColor, fontSize: 28, fontWeight: 800 }}>{p.showValues !== false ? `${total}${unit}` : ''}</div></div><div style={{ display: 'grid', gap: 12 }}>{values.map((v, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, color: textColor, fontSize: 16 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: colors[i % colors.length] }} /><span>{labels[i] || `数据 ${i + 1}`}</span>{p.showValues !== false && <strong style={{ marginLeft: 10 }}>{v}{unit}</strong>}</div>)}</div></div></div>;
  }

  const padX = 34, top = p.title ? 74 : 30, bottom = 42, innerW = Math.max(1, W - padX * 2), innerH = Math.max(1, H - top - bottom), slot = innerW / Math.max(1, values.length);
  const points = values.map((v, i) => ({ x: padX + slot * (i + .5), y: top + innerH - (v / max) * innerH }));
  const line = points.map((pt, i) => `${i ? 'L' : 'M'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
  const area = points.length ? `${line} L${points[points.length - 1].x},${top + innerH} L${points[0].x},${top + innerH} Z` : '';
  return <div style={shell}><svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: FONT }}>
    {p.title && <text x={padX} y={38} fill={textColor} fontSize={Math.min(24, H * .065)} fontWeight={700}>{p.title}</text>}
    {p.showGrid && [0,.25,.5,.75,1].map((g) => <line key={g} x1={padX} x2={W-padX} y1={top + innerH * (1-g)} y2={top + innerH * (1-g)} stroke="rgba(127,127,127,.22)" />)}
    {p.type === 'bar' && values.map((v,i) => { const h=(v/max)*innerH,bw=slot*.58,x=padX+slot*i+(slot-bw)/2,y=top+innerH-h; return <g key={i}><rect x={x} y={y} width={bw} height={h} rx={Math.min(8,bw/3)} fill={colors[i%2]} />{p.showValues!==false&&<text x={x+bw/2} y={Math.max(top+14,y-8)} textAnchor="middle" fill={textColor} fontSize={14}>{v}{unit}</text>}<text x={x+bw/2} y={H-16} textAnchor="middle" fill={textColor} opacity={.68} fontSize={13}>{labels[i]||i+1}</text></g> })}
    {p.type === 'area' && <path d={area} fill={p.color} opacity={.24} />}
    {(p.type === 'line'||p.type === 'area') && <g><path d={line} fill="none" stroke={p.color} strokeWidth={4} strokeLinejoin="round" />{points.map((pt,i)=><g key={i}><circle cx={pt.x} cy={pt.y} r={5} fill={p.secondaryColor||p.color} />{p.showValues!==false&&<text x={pt.x} y={pt.y-13} textAnchor="middle" fill={textColor} fontSize={13}>{values[i]}{unit}</text>}<text x={pt.x} y={H-16} textAnchor="middle" fill={textColor} opacity={.68} fontSize={13}>{labels[i]||i+1}</text></g>)}</g>}
  </svg></div>;
}
