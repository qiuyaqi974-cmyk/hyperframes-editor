import type { ExternalMediaSource, ProjectSnapshot, SourceTranscriptSegment } from '@/types';
import { parseSrt } from '@/lib/srt';

export interface SourceMediaInspection {
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  size: number;
}

export interface EditDecisionRange {
  source: string;
  start: number;
  end: number;
  label?: string;
}

export interface EditDecisionList {
  version: number;
  sources: Record<string, string>;
  ranges: EditDecisionRange[];
}

export function sourceIdFor(path: string) {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `source-${(hash >>> 0).toString(36)}`;
}

export function inspectionToSource(item: SourceMediaInspection): ExternalMediaSource {
  return {
    id: sourceIdFor(item.path.toLowerCase()),
    name: item.name,
    path: item.path,
    duration: item.duration,
    width: item.width,
    height: item.height,
    size: item.size,
    status: 'original',
    createdAt: new Date().toISOString(),
  };
}

export function parseEditDecisionList(value: unknown): EditDecisionList {
  if (!value || typeof value !== 'object') throw new Error('EDL 必须是 JSON 对象。');
  const data = value as Record<string, unknown>;
  const sources = data.sources;
  const ranges = data.ranges;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) throw new Error('EDL 缺少 sources 路径表。');
  if (!Array.isArray(ranges) || !ranges.length) throw new Error('EDL 没有可导入的 ranges。');
  const normalizedSources = Object.fromEntries(Object.entries(sources).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1])));
  const normalizedRanges = ranges.map((range, index) => {
    if (!range || typeof range !== 'object') throw new Error(`EDL 第 ${index + 1} 个选段无效。`);
    const item = range as Record<string, unknown>;
    const source = String(item.source ?? '');
    const start = Number(item.start);
    const end = Number(item.end);
    if (!normalizedSources[source]) throw new Error(`EDL 第 ${index + 1} 个选段引用了未知素材 ${source}。`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(`EDL 第 ${index + 1} 个选段时间无效。`);
    return { source, start, end, ...(typeof item.label === 'string' ? { label: item.label } : {}) };
  });
  return { version: Number(data.version) || 1, sources: normalizedSources, ranges: normalizedRanges };
}

export function parseSourceTranscript(input: string): SourceTranscriptSegment[] {
  return parseSrt(input.replace(/^WEBVTT[^\n]*\n+/i, ''))
    .map((scene) => ({ id: scene.id, start: scene.start, end: scene.end, text: scene.text.replace(/<[^>]+>/g, '').trim() }))
    .filter((segment) => segment.text);
}

export function searchSourceTranscript(segments: SourceTranscriptSegment[], rawQuery: string) {
  const terms = rawQuery.toLowerCase().split(/[\s，。！？、；：,.!?;:]+/).filter(Boolean);
  if (!terms.length) return [];
  return segments
    .map((segment) => {
      const text = segment.text.toLowerCase();
      const matched = terms.filter((term) => text.includes(term));
      return { segment, score: matched.reduce((sum, term) => sum + term.length, 0) + (matched.length === terms.length ? 20 : 0) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.segment.start - b.segment.start)
    .map((item) => item.segment);
}

export function localPathToFileUrl(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const leading = /^[A-Za-z]:\//.test(normalized) ? '/' : '';
  return encodeURI(`file://${leading}${normalized}`).replace(/#/g, '%23');
}

/** 最终渲染永远绑定原片，代理文件只服务编辑预览。 */
export function materializeExternalMediaForRender(snapshot: ProjectSnapshot): ProjectSnapshot {
  const sourceMap = new Map((snapshot.sourceMedia ?? []).map((source) => [source.id, source]));
  return {
    ...snapshot,
    blocks: snapshot.blocks.map((block) => {
      if (block.type !== 'video' || !block.props.externalSourceId) return block;
      const source = sourceMap.get(block.props.externalSourceId);
      if (!source) return block;
      return { ...block, props: { ...block.props, src: localPathToFileUrl(source.path) } };
    }),
  };
}
