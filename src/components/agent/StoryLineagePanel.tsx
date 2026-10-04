import { useId, useMemo, useState } from 'react';
import { buildStoryLineage, layoutStoryLineage, type StoryLineageEvidence } from '@/lib/storyLineage';
import type { ProjectSnapshot } from '@/types';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';

export default function StoryLineagePanel({ snapshot, candidate, evidence }: { snapshot: ProjectSnapshot; candidate?: ReleaseCandidate; evidence?: StoryLineageEvidence }) {
  const [scope, setScope] = useState<'current' | 'rc'>('current');
  const [selectedId, setSelectedId] = useState('');
  const [wide, setWide] = useState(false);
  const markerId = `lineage-${useId().replace(/:/g, '')}`;
  const graph = useMemo(() => buildStoryLineage(snapshot, scope === 'rc' ? candidate : undefined, evidence), [snapshot, candidate, evidence, scope]);
  const nodes = useMemo(() => layoutStoryLineage(graph), [graph]);
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes.find((node) => node.id === 'rc') ?? nodes.find((node) => node.id === 'selection') ?? nodes[0];
  const positions = new Map(nodes.map((node) => [node.id, node]));
  const width = Math.max(330, ...nodes.map((node) => node.x + 175));
  const height = Math.max(100, ...nodes.map((node) => node.y + 85));
  return <details open={wide || undefined} className={wide ? 'fixed inset-6 z-[80] overflow-auto rounded-xl border border-indigo-300/25 bg-panel p-5 shadow-2xl' : 'rounded border border-indigo-300/25 bg-panel/60 p-2'} aria-label="版本血缘图">
    <summary className="cursor-pointer text-[11px] font-semibold text-indigo-100">版本与发布证据血缘图</summary>
    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-indigo-100"><button type="button" aria-pressed={scope === 'current'} onClick={() => { setScope('current'); setSelectedId(''); }} className="rounded border border-stroke p-1">当前工程</button><button type="button" aria-pressed={scope === 'rc'} disabled={!candidate} onClick={() => { setScope('rc'); setSelectedId(''); }} className="rounded border border-stroke p-1 disabled:opacity-40">选中 RC 冻结记录</button><button type="button" onClick={() => setWide(!wide)} className="rounded border border-stroke p-1">{wide ? '收起放大' : '放大查看'}</button></div>
    <p className="my-2 text-[9px] text-ink-faint">{graph.scope}。点击节点查看方案、RC、发布观察、实验、学习记录与 Brief 引用；横向滚动查看完整链路。本图只读，不修改任何证据或决定。</p>
    {graph.warnings.map((warning, index) => <p key={index} role="status" className="my-1 text-[9px] text-amber-200">{warning}</p>)}
    {!nodes.length ? <p className="text-[10px] text-ink-faint">还没有冻结方案或外部导入记录。</p> : <>
      <div className="max-h-80 overflow-auto rounded border border-stroke" aria-label="血缘关系画布" tabIndex={0}>
        <div className="relative" style={{ width, height }}>
          <svg width={width} height={height} className="pointer-events-none absolute inset-0" aria-hidden="true">
            <defs><marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#818cf8" /></marker></defs>
            {graph.edges.map((edge) => {
              const from = positions.get(edge.from)!; const to = positions.get(edge.to)!;
              const x1 = from.x + 154; const y1 = from.y + 31; const x2 = to.x; const y2 = to.y + 31;
              return <path key={`${edge.from}:${edge.to}`} d={`M${x1},${y1} C${x1 + 24},${y1} ${x2 - 24},${y2} ${x2},${y2}`} fill="none" stroke="#818cf8" strokeWidth={selected?.id === edge.from || selected?.id === edge.to ? 2 : 1} opacity={selected?.id === edge.from || selected?.id === edge.to ? 1 : 0.5} markerEnd={`url(#${markerId})`} />;
            })}
          </svg>
          {nodes.map((node) => <button type="button" key={node.id} aria-pressed={selected?.id === node.id} aria-label={`${node.label}：${node.status}`} onClick={() => setSelectedId(node.id)} className={`absolute h-[64px] w-[154px] rounded border px-2 text-left text-[10px] ${selected?.id === node.id ? 'border-indigo-300 bg-indigo-950 text-white' : 'border-stroke bg-panel-2 text-ink'}`} style={{ left: node.x, top: node.y }}><span className="block truncate font-semibold">{node.label}</span><span className="block text-[9px] text-ink-faint">{node.status}</span></button>)}
        </div>
      </div>
      {selected && <div className="mt-2 space-y-1 text-[10px]" aria-label="血缘节点详情"><p className="font-semibold text-indigo-100">{selected.label}</p><dl>{selected.details.map(([label, value], index) => <div key={index} className="mt-1"><dt className="text-[9px] text-ink-faint">{label}</dt><dd className="break-all text-ink">{value || '未记录'}</dd></div>)}</dl><p className="pt-1 text-ink-faint">连接关系</p>{graph.edges.filter((e) => e.from === selected.id || e.to === selected.id).map((e) => <p key={`${e.from}:${e.to}`}>{positions.get(e.from)?.label} → {positions.get(e.to)?.label}（{e.label}）</p>)}</div>}
    </>}
  </details>;
}
