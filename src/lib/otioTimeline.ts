import type { ExternalMediaSource, SourceStoryAssemblyVersion } from '@/types';
import type { ImportedEdl } from './sourceStoryRoundtrip';

type Node = Record<string, unknown>;
export interface OtioClip {
  trackIndex: number;
  childIndex: number;
  name: string;
  path: string;
  sourceId?: string;
  candidateId?: string;
  beat?: string;
  quote?: string;
  start: number;
  end: number;
  duration: number;
  outputStart: number;
  speed: number;
  handleStart: number;
  handleEnd: number;
}
export interface OtioAnalysis {
  document: Node;
  clips: OtioClip[];
  tracks: Array<{ name: string; kind: string; duration: number; clips: number }>;
  transitions: Array<{ trackIndex: number; childIndex: number; type: string; inOffset: number; outOffset: number; at: number }>;
  blockers: string[];
  duration: number;
  originVersionId?: string;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const pathKey = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
function node(value: unknown, label: string): Node {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`OTIO ${label} 不是有效对象。`);
  return value as Node;
}
function children(value: Node): Node[] {
  if (!Array.isArray(value.children)) throw new Error('OTIO 缺少轨道/片段列表。');
  return value.children.map((child) => node(child, '子项'));
}
function schema(value: Node, expected: string[]) {
  if (!expected.includes(String(value.OTIO_SCHEMA))) throw new Error(`暂不支持 OTIO 类型 ${String(value.OTIO_SCHEMA)}；不会丢弃后继续导入。`);
}
function seconds(value: unknown): number {
  const time = node(value, '时间');
  schema(time, ['RationalTime.1']);
  if (typeof time.value !== 'number' || !Number.isFinite(time.value) || typeof time.rate !== 'number' || !Number.isFinite(time.rate) || time.rate <= 0) throw new Error('OTIO 时间值或帧率无效。');
  const result = time.value / time.rate;
  if (!Number.isFinite(result)) throw new Error('OTIO 时间值溢出。');
  return result;
}
function timeRange(value: unknown) {
  const range = node(value, '时间范围');
  schema(range, ['TimeRange.1']);
  const start = seconds(range.start_time);
  const duration = seconds(range.duration);
  if (duration < 0) throw new Error('OTIO 时长不能为负数。');
  return { start, duration };
}
function metadata(value: Node): Node {
  const data = value.metadata;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const hf = (data as Node).hyperframes;
  return hf && typeof hf === 'object' && !Array.isArray(hf) ? hf as Node : {};
}
export function otioPath(value: unknown): string {
  if (typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value)) throw new Error('OTIO 素材路径无效。');
  if (/^file:/i.test(value)) {
    const url = new URL(value);
    if (url.search || url.hash || url.username || url.password) throw new Error('OTIO 文件 URL 含歧义参数。');
    const path = decodeURIComponent(url.pathname);
    return url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}${path}` : path.replace(/^\/([a-z]:\/)/i, '$1');
  }
  if (!/^[a-z]:[\\/]/i.test(value) && !value.startsWith('/') && !value.startsWith('\\\\')) throw new Error('OTIO 仅接受绝对本地路径或 file URL；请先在外部工具重新链接素材。');
  return value;
}
function mediaReference(clip: Node): Node {
  if (clip.OTIO_SCHEMA === 'Clip.1') return node(clip.media_reference, '媒体引用');
  const refs = node(clip.media_references, '媒体引用表');
  if (typeof clip.active_media_reference_key !== 'string') throw new Error('OTIO 缺少当前媒体引用键。');
  return node(refs[clip.active_media_reference_key], '当前媒体引用');
}

/** Narrow, explicit OTIO profile: top-level tracks, clips, gaps, transitions and positive linear retimes. */
export function analyzeOtio(input: unknown): OtioAnalysis {
  const document = clone(node(input, '时间线'));
  schema(document, ['Timeline.1']);
  const stack = node(document.tracks, '轨道栈');
  schema(stack, ['Stack.1']);
  const tracks = children(stack);
  if (!tracks.length || tracks.length > 128) throw new Error('OTIO 轨道数量无效。');
  const blockers = new Set<string>();
  const clips: OtioClip[] = [];
  const transitions: OtioAnalysis['transitions'] = [];
  const summary: OtioAnalysis['tracks'] = [];
  const checkContainer = (item: Node) => {
    if (item.source_range != null) throw new Error('暂不支持裁切的 OTIO 轨道/轨道栈，请先展开后导回。');
    if (Array.isArray(item.effects) && item.effects.length) throw new Error('暂不支持轨道级效果，请先在外部工具处理。');
    if (item.enabled === false) blockers.add('含禁用轨道或片段');
  };
  checkContainer(stack);
  if (document.global_start_time != null && seconds(document.global_start_time) !== 0) blockers.add('非零时间线起始时间码');
  if (tracks.length !== 1) blockers.add('多轨叠加');
  tracks.forEach((track, trackIndex) => {
    schema(track, ['Track.1']);
    checkContainer(track);
    if (track.kind !== 'Video' && track.kind !== 'Audio') throw new Error('OTIO 轨道类型必须为 Video 或 Audio。');
    if (track.kind === 'Audio') blockers.add('独立音轨');
    const items = children(track);
    if (items.length > 10000) throw new Error('OTIO 单轨片段过多。');
    let cursor = 0;
    let count = 0;
    items.forEach((item, childIndex) => {
      schema(item, ['Clip.1', 'Clip.2', 'Gap.1', 'Transition.1']);
      if (item.OTIO_SCHEMA === 'Transition.1') {
        const inOffset = seconds(item.in_offset);
        const outOffset = seconds(item.out_offset);
        if (inOffset < 0 || outOffset < 0 || inOffset + outOffset <= 0) throw new Error('OTIO 转场长度无效。');
        if (!String(items[childIndex - 1]?.OTIO_SCHEMA).startsWith('Clip.') || !String(items[childIndex + 1]?.OTIO_SCHEMA).startsWith('Clip.')) throw new Error('OTIO 转场必须位于两个片段之间。');
        transitions.push({ trackIndex, childIndex, type: String(item.transition_type ?? ''), inOffset, outOffset, at: cursor });
        blockers.add('转场');
        return; // Transitions overlap their neighbors; they do not advance the track cursor.
      }
      if (item.enabled === false) blockers.add('含禁用轨道或片段');
      if (item.OTIO_SCHEMA === 'Gap.1') {
        const range = timeRange(item.source_range);
        if (Array.isArray(item.effects) && item.effects.length) throw new Error('暂不支持间隙效果。');
        cursor += range.duration;
        if (range.duration > 0) blockers.add('轨道间隙');
        return;
      }
      const reference = mediaReference(item);
      schema(reference, ['ExternalReference.1']);
      const available = reference.available_range != null ? timeRange(reference.available_range) : undefined;
      const range = timeRange(item.source_range ?? reference.available_range);
      if (range.duration <= 0) throw new Error('OTIO 片段时长必须大于零。');
      let speed = 1;
      const effects = item.effects ?? [];
      if (!Array.isArray(effects)) throw new Error('OTIO 效果列表无效。');
      for (const raw of effects) {
        const effect = node(raw, '效果');
        schema(effect, ['LinearTimeWarp.1']);
        if (typeof effect.time_scalar !== 'number' || !Number.isFinite(effect.time_scalar) || effect.time_scalar <= 0) throw new Error('暂不支持倒放、定格或非正数速度；请先在外部工具处理。');
        if (effect.enabled !== false) speed *= effect.time_scalar;
      }
      if (!Number.isFinite(speed) || speed <= 0) throw new Error('OTIO 速度无效。');
      if (Math.abs(speed - 1) > 1e-9) blockers.add('变速');
      const start = range.start - (available?.start ?? 0);
      // Retimes retain their OTIO duration. Audit a conservative media envelope instead of pretending it is a rendered cut.
      const end = start + range.duration * Math.max(1, speed);
      const info = metadata(item);
      clips.push({ trackIndex, childIndex, name: String(item.name ?? ''), path: otioPath(reference.target_url), sourceId: typeof info.sourceId === 'string' ? info.sourceId : undefined, candidateId: typeof info.candidateId === 'string' ? info.candidateId : undefined, beat: typeof info.narrativeRole === 'string' ? info.narrativeRole : undefined, quote: typeof info.text === 'string' ? info.text : undefined, start, end, duration: range.duration, outputStart: cursor, speed, handleStart: start, handleEnd: end });
      cursor += range.duration;
      count += 1;
    });
    summary.push({ name: String(track.name ?? `轨道 ${trackIndex + 1}`), kind: String(track.kind), duration: cursor, clips: count });
  });
  for (const transition of transitions) {
    const left = clips.find((clip) => clip.trackIndex === transition.trackIndex && clip.childIndex === transition.childIndex - 1)!;
    const right = clips.find((clip) => clip.trackIndex === transition.trackIndex && clip.childIndex === transition.childIndex + 1)!;
    if (transition.inOffset > left.duration || transition.outOffset > right.duration) throw new Error('OTIO 转场超过相邻片段时长。');
    left.handleEnd += transition.outOffset * Math.max(1, left.speed);
    right.handleStart -= transition.inOffset * Math.max(1, right.speed);
  }
  if (!clips.length) throw new Error('OTIO 没有可审核的媒体片段。');
  const keys = clips.map((clip) => `${pathKey(clip.path)}:${clip.candidateId ?? ''}:${clip.start}:${clip.end}`);
  if (new Set(keys).size !== keys.length) blockers.add('重复使用同一素材范围');
  const origin = metadata(document).originVersionId;
  return { document, clips, tracks: summary, transitions, blockers: [...blockers], duration: Math.max(...summary.map((track) => track.duration)), originVersionId: typeof origin === 'string' ? origin : undefined };
}

export function otioToEdl(input: unknown, base: SourceStoryAssemblyVersion, sources: ExternalMediaSource[]) {
  const analysis = analyzeOtio(input);
  if (analysis.originVersionId !== base.id) throw new Error('OTIO 缺少当前父胜出方案标识或来源版本不匹配；请使用从本工程导出的时间线。');
  const ranges: ImportedEdl['ranges'] = [];
  const paths: Record<string, string> = {};
  const rangeIndexes: number[] = [];
  const seen = new Map<string, number>();
  const usedCandidates = new Set<string>();
  for (const clip of analysis.clips) {
    const source = clip.sourceId ? sources.find((s) => s.id === clip.sourceId) : sources.find((s) => pathKey(s.path) === pathKey(clip.path));
    if (!source) throw new Error('OTIO 引用了工程外素材或未知原片 ID。');
    if (pathKey(source.path) !== pathKey(clip.path)) throw new Error('OTIO 素材路径与工程记录不一致。');
    if (clip.handleStart < -1e-8 || clip.handleEnd > source.duration + 1e-8) throw new Error('OTIO 片段或转场/变速所需素材超出原片范围。');
    const words = (source.transcript ?? []).flatMap((s) => s.words ?? []);
    if (words.some((w) => [clip.start, clip.end, clip.handleStart, clip.handleEnd].some((t) => t > w.start + 0.005 && t < w.end - 0.005))) throw new Error('OTIO 切点或转场边界落在词语内部。');
    const key = `${source.id}:${clip.candidateId ?? ''}:${clip.start}:${clip.end}:${clip.beat ?? ''}:${clip.quote ?? ''}`;
    const seenIndex = seen.get(key);
    if (seenIndex !== undefined) { rangeIndexes.push(seenIndex); continue; }
    const alias = `S${Object.keys(paths).length + 1}`;
    paths[alias] = source.path;
    const candidateKey = `${source.id}:${clip.candidateId}`;
    const candidateId = clip.candidateId && !usedCandidates.has(candidateKey) ? clip.candidateId : undefined;
    usedCandidates.add(candidateKey);
    rangeIndexes.push(ranges.length);
    seen.set(key, ranges.length);
    ranges.push({ source: alias, sourceId: source.id, candidateId, start: Math.max(0, clip.start), end: clip.end, label: clip.name, quote: clip.quote, beat: clip.beat as ImportedEdl['ranges'][number]['beat'] });
  }
  return { analysis, rangeIndexes, edl: { version: 1, metadata: { originVersionId: base.id }, sources: paths, ranges } satisfies ImportedEdl };
}

const rational = (seconds: number, rate: number): Node => ({ OTIO_SCHEMA: 'RationalTime.1', value: seconds * rate, rate });
const range = (start: number, duration: number, rate: number): Node => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rational(start, rate), duration: rational(duration, rate) });
function fileUrl(path: string) {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    const [host, ...parts] = normalized.slice(2).split('/');
    return `file://${host}/${parts.map(encodeURIComponent).join('/')}`;
  }
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized.split('/').map((part, index) => index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/')}`;
}

export function createOtioTimeline(version: SourceStoryAssemblyVersion, sources: ExternalMediaSource[], name: string, fps = 30): Node {
  if (version.externalTimeline) {
    const document = clone(version.externalTimeline.document);
    // A new handoff must point back to this version, not its parent.
    const data = node(document.metadata ?? {}, 'metadata');
    document.metadata = { ...data, hyperframes: { ...metadata(document), originVersionId: version.id } };
    otioToEdl(document, version, sources);
    return document;
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('OTIO 导出帧率无效。');
  const items = version.segments.map((segment) => {
    const source = sources.find((s) => s.id === segment.sourceId);
    if (!source) throw new Error('OTIO 导出原片缺失。');
    return { OTIO_SCHEMA: 'Clip.2', name: segment.sourceName, metadata: { hyperframes: { sourceId: source.id, candidateId: segment.candidateId, narrativeRole: segment.narrativeRole, text: segment.text } }, source_range: range(segment.start, segment.end - segment.start, fps), effects: [], markers: [], enabled: true, active_media_reference_key: 'DEFAULT_MEDIA', media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', name: source.name, target_url: fileUrl(source.path), available_range: range(0, source.duration, fps), metadata: {} } } };
  });
  const document = { OTIO_SCHEMA: 'Timeline.1', name, metadata: { hyperframes: { originVersionId: version.id } }, global_start_time: rational(0, fps), tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', source_range: null, effects: [], markers: [], metadata: {}, children: [{ OTIO_SCHEMA: 'Track.1', name: 'V1', kind: 'Video', source_range: null, effects: [], markers: [], metadata: {}, children: items }] } };
  otioToEdl(document, version, sources);
  return document;
}

/** Rejected clips become equal-duration gaps, preventing shifts on other tracks. Adjacent transitions are removed. */
export function applyOtioReview(input: unknown, base: SourceStoryAssemblyVersion, sources: ExternalMediaSource[], decisions: Map<number, { reject: boolean; candidateId?: string; role?: string; reason: string }>): Node {
  const { analysis, rangeIndexes } = otioToEdl(input, base, sources);
  const document = analysis.document;
  const tracks = children(node(document.tracks, '轨道栈'));
  const rejected = new Set<string>();
  analysis.clips.forEach((clip, index) => {
    const decision = decisions.get(rangeIndexes[index]);
    if (!decision) return;
    const track = tracks[clip.trackIndex];
    const items = children(track);
    const item = items[clip.childIndex];
    if (decision.reject) {
      rejected.add(`${clip.trackIndex}:${clip.childIndex}`);
      items[clip.childIndex] = { OTIO_SCHEMA: 'Gap.1', name: '人工拒绝片段', source_range: range(0, clip.duration, 1000), effects: [], markers: [], metadata: { hyperframes: { rejectionReason: decision.reason } } };
    } else {
      item.metadata = { ...(item.metadata as Node ?? {}), hyperframes: { ...metadata(item), candidateId: decision.candidateId, narrativeRole: decision.role } };
    }
    track.children = items;
  });
  tracks.forEach((track, trackIndex) => {
    track.children = children(track).filter((item, index) => item.OTIO_SCHEMA !== 'Transition.1' || (!rejected.has(`${trackIndex}:${index - 1}`) && !rejected.has(`${trackIndex}:${index + 1}`)));
  });
  node(document.tracks, '轨道栈').children = tracks;
  return document;
}
