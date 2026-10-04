import { sourceStoryAssemblyVersionSignature } from '@/lib/sourceStoryVersions';
import { createOtioTimeline } from '@/lib/otioTimeline';
import { createFcpxmlTimeline } from '@/lib/fcpxmlTimeline';
import type { NarrativeRole, ProjectSnapshot } from '@/types';

export interface StoryHandoffSource {
  id: string;
  alias: string;
  name: string;
  path: string;
  expectedDuration: number;
  expectedSize: number;
}

export interface StoryHandoffRange {
  index: number;
  source: string;
  sourceId: string;
  start: number;
  end: number;
  duration: number;
  outputStart: number;
  outputEnd: number;
  label: string;
  text: string;
  narrativeRole?: NarrativeRole;
}

export interface WinningStoryHandoffPayload {
  otio?: Record<string, unknown>;
  fcpxml?: string;
  version: 1;
  kind: 'hyperframes-winning-story-handoff';
  projectName: string;
  exportedAt: string;
  winner: { id: string; label: string; note: string; rationale: string; selectedAt: string };
  sources: StoryHandoffSource[];
  ranges: StoryHandoffRange[];
  totalDuration: number;
  edl: {
    version: 1;
    kind: 'hyperframes-story-edl';
    metadata: { projectName: string; originVersionId: string; originVersionLabel: string; exportedAt: string; rationale: string };
    sources: Record<string, string>;
    ranges: Array<{ source: string; sourceId: string; candidateId: string; start: number; end: number; label: string; beat?: NarrativeRole; quote: string }>;
  };
  subtitlesSrt: string;
  clipListCsv: string;
  readme: string;
}

const roleNames: Record<NarrativeRole, string> = {
  hook: '钩子', context: '背景', argument: '核心', proof: '证明', turn: '转折', cta: '结尾', custom: '自定义',
};

function srtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const secs = Math.floor(milliseconds % 60_000 / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function csv(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function createWinningStoryHandoff(snapshot: ProjectSnapshot, now = new Date()): WinningStoryHandoffPayload {
  const selection = snapshot.storyVersionSelection;
  if (!selection) throw new Error('还没有选出胜出方案，不能导出精剪交接包。');
  const versions = snapshot.storyAssemblyVersions ?? [];
  const winner = versions.find((version) => version.id === selection.winnerVersionId);
  if (!winner) throw new Error('胜出方案已经失效，请重新选版。');
  const sources = snapshot.sourceMedia ?? [];
  if (!snapshot.storyAssembly) throw new Error('当前工程没有全局粗剪结构。');
  const currentSignature = sourceStoryAssemblyVersionSignature(snapshot.storyAssembly, sources);
  if (!currentSignature || currentSignature !== winner.signature) throw new Error('当前时间轴不是胜出方案；请先恢复胜出方案、确认并装配。');
  if (!snapshot.storyAssembly.appliedAt || !snapshot.storyAssembly.appliedBlockIds?.length) throw new Error('胜出方案还没有装配到正式时间轴。');

  const sourceIds = [...new Set(winner.segments.map((segment) => segment.sourceId))];
  const handoffSources = sourceIds.map((sourceId, index) => {
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error(`胜出方案引用的素材 ${sourceId} 已不存在。`);
    return {
      id: source.id, alias: `S${String(index + 1).padStart(3, '0')}`, name: source.name, path: source.path,
      expectedDuration: source.duration, expectedSize: source.size,
    };
  });
  const aliasById = new Map(handoffSources.map((source) => [source.id, source.alias]));
  let cursor = 0;
  const ranges = winner.segments.map((segment, index) => {
    const source = handoffSources.find((item) => item.id === segment.sourceId)!;
    if (segment.start < 0 || segment.end <= segment.start || segment.end > source.expectedDuration + 0.05) {
      throw new Error(`第 ${index + 1} 段超出原片有效范围。`);
    }
    const duration = segment.end - segment.start;
    const outputStart = cursor;
    cursor += duration;
    return {
      index: index + 1, source: aliasById.get(segment.sourceId)!, sourceId: segment.sourceId,
      start: segment.start, end: segment.end, duration, outputStart, outputEnd: cursor,
      label: `${String(index + 1).padStart(2, '0')} ${segment.narrativeRole ? roleNames[segment.narrativeRole] : '片段'} · ${segment.sourceName}`,
      text: segment.text.trim(), narrativeRole: segment.narrativeRole,
    };
  });
  const subtitlesSrt = ranges.filter((range) => range.text).map((range, index) =>
    `${index + 1}\n${srtTime(range.outputStart)} --> ${srtTime(range.outputEnd)}\n${range.text}\n`,
  ).join('\n');
  const columns = ['序号', '素材别名', '素材文件', '原片入点秒', '原片出点秒', '片段时长秒', '成片入点秒', '成片出点秒', '叙事职责', '口播文本'];
  const clipListCsv = `\uFEFF${columns.map(csv).join(',')}\r\n${ranges.map((range) => {
    const source = handoffSources.find((item) => item.id === range.sourceId)!;
    return [range.index, range.source, source.name, range.start.toFixed(3), range.end.toFixed(3), range.duration.toFixed(3), range.outputStart.toFixed(3), range.outputEnd.toFixed(3), range.narrativeRole ? roleNames[range.narrativeRole] : '', range.text].map(csv).join(',');
  }).join('\r\n')}\r\n`;
  const readme = `# ${snapshot.projectName} · 胜出方案精剪交接包

胜出方案：${winner.label}\n导演结论：${selection.rationale}\n总时长：${cursor.toFixed(3)} 秒\n片段数：${ranges.length}\n原片数：${handoffSources.length}

## 这是什么

这是 HyperFrames 已确认粗剪顺序和入出点的稳定中间包。原片没有被复制、裁切或改写。它不伪装成剪映私有草稿；剪映版本变化时，EDL、CSV 和 SRT 仍可核对。

## 在剪映里继续

1. 按 sources.json 的路径导入原片；素材离线时，用文件名、大小和 verification.json 的快速指纹重新链接。
2. 按 clip-list.csv 的序号排列片段，并使用“原片入点秒 / 原片出点秒”裁切。
3. 导入 timeline.srt。这里是粗剪片段级字幕，精剪阶段仍应使用逐字转录修正断句。
4. edl.json 记录本机粗剪切点；CSV 适合人工检查。不要根据预览视频反推切点。
5. 支持 OpenTimelineIO 的工具可使用 timeline.otio；它保留轨道、转场和速度字段。外部编辑时保留 metadata.hyperframes 来源标识，便于重新导回审核。复杂 OTIO 可保存和重新导出，但当前本机预演器不渲染多轨、转场或变速，不可把简化切点清单作为完整成片。
6. Final Cut Pro 或兼容工具可使用 timeline.fcpxml。当前 FCPXML 1.10 只承诺无间隙、无重叠、无转场和无变速的主故事线往返；请保留 com.hyperframes 元数据。导回仍先显示差异，工程内新增片段仍需人工审核。

## 校验说明

导出时桌面端会重新检查文件存在性、大小、时长和所有切点，并记录 SHA-256 首尾采样快速指纹。该指纹用于识别错版素材，不等同于全文件哈希。verification.json 全部为 pass，交接包才会生成。
`;
  return {
    otio: createOtioTimeline(winner, sources, snapshot.projectName, snapshot.canvas.fps),
    fcpxml: createFcpxmlTimeline(winner, sources, snapshot.projectName, snapshot.canvas.fps),
    version: 1, kind: 'hyperframes-winning-story-handoff', projectName: snapshot.projectName, exportedAt: now.toISOString(),
    winner: { id: winner.id, label: winner.label, note: winner.note, rationale: selection.rationale, selectedAt: selection.selectedAt },
    sources: handoffSources, ranges, totalDuration: cursor,
    edl: {
      version: 1, kind: 'hyperframes-story-edl',
      metadata: { projectName: snapshot.projectName, originVersionId: winner.id, originVersionLabel: winner.label, exportedAt: now.toISOString(), rationale: selection.rationale },
      sources: Object.fromEntries(handoffSources.map((source) => [source.alias, source.path])),
      ranges: ranges.map((range) => {
        const segment = winner.segments[range.index - 1];
        return { source: range.source, sourceId: range.sourceId, candidateId: segment.candidateId, start: range.start, end: range.end, label: range.label, ...(range.narrativeRole ? { beat: range.narrativeRole } : {}), quote: range.text };
      }),
    },
    subtitlesSrt, clipListCsv, readme,
  };
}
