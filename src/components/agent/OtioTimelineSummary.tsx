import { analyzeOtio } from '@/lib/otioTimeline';
import type { ExternalTimeline } from '@/types';

export default function OtioTimelineSummary({ timeline }: { timeline: ExternalTimeline }) {
  try {
    const info = analyzeOtio(timeline.document);
    return <div className="space-y-1 rounded border border-sky-300/20 p-1 text-[8px] text-sky-100">
      <p>OTIO · {info.tracks.length} 条轨道 · {info.clips.length} 个片段 · {info.transitions.length} 个转场 · 时间线 {info.duration.toFixed(3)} 秒</p>
      <p>轨道、转场、速度及原始时间码随方案保留。下方切点差异是素材审核清单，不代表多轨成片时长。</p>
      {info.tracks.map((track, index) => <p key={index}>{track.name} · {track.kind === 'Audio' ? '音频' : '视频'} · {track.clips} 段 · {track.duration.toFixed(3)} 秒</p>)}
      <details><summary>查看轨道位置、速度和转场</summary>
        {info.clips.map((clip, index) => <p key={index}>轨道 {clip.trackIndex + 1} / {clip.name || `片段 ${index + 1}`} · 时间线 {clip.outputStart.toFixed(3)}–{(clip.outputStart + clip.duration).toFixed(3)}s · 速度 {clip.speed}× · 原片审核范围 {clip.start.toFixed(3)}–{clip.end.toFixed(3)}s</p>)}
        {info.transitions.map((transition, index) => <p key={`t${index}`}>轨道 {transition.trackIndex + 1} · {transition.type} @ {transition.at.toFixed(3)}s · 前 {transition.inOffset.toFixed(3)}s / 后 {transition.outOffset.toFixed(3)}s</p>)}
      </details>
      {info.blockers.length ? <p className="text-amber-200">含{info.blockers.join('、')}：可保存并重新导出，但当前不能本机恢复、预演或进入 RC。拒绝片段将替换为等长间隙，并移除相邻转场，防止其他轨道错位。</p> : <p>可恢复到本机流程；仍需重新视觉检查、预演和选版。</p>}
    </div>;
  } catch (error) { return <p className="text-red-300">{error instanceof Error ? error.message : String(error)}</p>; }
}
