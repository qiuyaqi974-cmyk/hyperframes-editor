import type { ExternalMediaSource, SourceActionSemantics, SourceActionVisualEvidence, SourceEventMarker, SourceEventMarkerKind } from '@/types';

export const actionShotLabels = { unspecified: '未指定', wide: '全景', medium: '中景', closeup: '近景', detail: '特写' } as const;

export function actionSourceSignature(source: ExternalMediaSource) {
  // 引用元数据签名，不读取整片；不是文件内容哈希。
  return JSON.stringify([source.id, source.path, source.size, source.duration, source.width, source.height]);
}

export function validActionRange(source: ExternalMediaSource, start: number, end: number) {
  return source.status !== 'missing' && Number.isFinite(start) && Number.isFinite(end)
    && start >= 0 && end <= source.duration && end - start >= 0.1;
}

export function actionEntryIsCurrent(source: ExternalMediaSource, marker: SourceEventMarker) {
  return validActionRange(source, marker.start, marker.end) && (!marker.semantics || (
    marker.semantics.sourceSignature === actionSourceSignature(source)
    && marker.semantics.start === marker.start && marker.semantics.end === marker.end
  ));
}

export interface ActionIndexRow { source: ExternalMediaSource; marker: SourceEventMarker; current: boolean }

/** 索引人工观察文字，不从转写/静音推断画面动作，也不触发媒体扫描。 */
export function searchActionIndex(sources: ExternalMediaSource[], query: string, shot = '', kind = ''): ActionIndexRow[] {
  const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return sources.flatMap((source) => (source.eventMarkers ?? []).flatMap((marker) => {
    const semantic = marker.semantics;
    if (shot && semantic?.shot !== shot || kind && marker.kind !== kind) return [];
    const text = [source.name, source.path, marker.label, semantic?.subject, semantic?.action,
      semantic?.object, semantic?.result, ...(semantic?.tags ?? [])].join(' ').normalize('NFKC').toLocaleLowerCase();
    return terms.every((term) => text.includes(term)) ? [{ source, marker, current: actionEntryIsCurrent(source, marker) }] : [];
  })).sort((a, b) => a.source.name.localeCompare(b.source.name) || a.marker.start - b.marker.start);
}

export function createActionEntry(source: ExternalMediaSource, range: { start: number; end: number },
  input: Pick<SourceActionSemantics, 'subject' | 'action' | 'object' | 'result' | 'shot'> & { tags: string; kind: SourceEventMarkerKind },
  confirmed: boolean, visualEvidence?: SourceActionVisualEvidence): SourceEventMarker {
  if (!validActionRange(source, range.start, range.end)) throw new Error('原片离线或时间范围无效。');
  if (source.roughCutPlan?.appliedBlockIds?.length) throw new Error('请先撤销已追加的粗剪，再修改动作索引。');
  if (!confirmed) throw new Error('请先观看该区间并确认动作描述与边界。');
  if (!input.action.trim()) throw new Error('请填写亲眼观察到的动作。');
  if (!(input.shot in actionShotLabels) || !['action', 'highlight', 'exclude'].includes(input.kind)) throw new Error('无效的动作分类。');
  if (visualEvidence) {
    if (visualEvidence.source !== 'model-assisted' || !['single-frame', 'cross-frame'].includes(visualEvidence.mode)
      || !['initial', 'refinement'].includes(visualEvidence.analysisPass) || !visualEvidence.providerId.trim() || !visualEvidence.model.trim()) throw new Error('视觉证据回执格式无效。');
    if (visualEvidence.transcriptIncluded !== undefined && typeof visualEvidence.transcriptIncluded !== 'boolean') throw new Error('视觉证据口播输入标记无效。');
    if (visualEvidence.requestPayload) {
      const payload = visualEvidence.requestPayload;
      if (!payload.requestId.trim() || payload.requestId.length > 160 || !Number.isFinite(Date.parse(payload.requestedAt))
        || !Number.isInteger(payload.imageCount) || payload.imageCount < 1 || payload.imageCount > 12
        || !Number.isInteger(payload.imageBytes) || payload.imageBytes < 1 || payload.imageBytes > 8 * 1024 * 1024
        || !Number.isInteger(payload.transcriptCharacters) || payload.transcriptCharacters < 0 || payload.transcriptCharacters > 12 * 4000
        || !Number.isFinite(payload.spanSeconds) || payload.spanSeconds < 0
        || !Number.isInteger(payload.sessionRequestNumber) || payload.sessionRequestNumber < 1) throw new Error('视觉请求负载回执无效。');
      if (visualEvidence.transcriptIncluded === false && payload.transcriptCharacters !== 0) throw new Error('仅截图回执不能包含口播字符。');
      if (payload.tokenUsage && (!Number.isSafeInteger(payload.tokenUsage.inputTokens) || payload.tokenUsage.inputTokens < 0
        || !Number.isSafeInteger(payload.tokenUsage.outputTokens) || payload.tokenUsage.outputTokens < 0
        || !Number.isSafeInteger(payload.tokenUsage.totalTokens) || payload.tokenUsage.totalTokens !== payload.tokenUsage.inputTokens + payload.tokenUsage.outputTokens)) throw new Error('视觉请求 token 用量回执无效。');
      if (payload.imageCount < visualEvidence.frames.length) throw new Error('视觉请求图片数少于候选证据图。');
      if (!Array.isArray(payload.frames) || payload.frames.length !== payload.imageCount
        || new Set(payload.frames.map((frame) => frame.id)).size !== payload.frames.length
        || payload.frames.some((frame) => !frame.id || !Number.isFinite(frame.time) || !/^[a-f0-9]{64}$/.test(frame.sha256 ?? '')
          || frame.perceptualHash !== undefined && !/^[a-f0-9]{16}$/.test(frame.perceptualHash))) throw new Error('视觉请求截图清单或内容指纹无效。');
      if (payload.duplicateFrameReview) {
        const review = payload.duplicateFrameReview;
        const confirmedAt = Date.parse(review.confirmedAt);
        const requestedAt = Date.parse(payload.requestedAt);
        const duplicateGroups = new Map<string, string[]>();
        payload.frames.forEach((frame) => duplicateGroups.set(frame.sha256!, [...(duplicateGroups.get(frame.sha256!) ?? []), frame.id]));
        const expectedGroups = [...duplicateGroups.entries()].filter(([, ids]) => ids.length > 1).map(([sha256, frameIds]) => ({ sha256, frameIds }));
        if (review.confirmed !== true || !Number.isFinite(confirmedAt) || confirmedAt > requestedAt || !Array.isArray(review.groups) || review.groups.length < 1
          || review.groups.some((group) => !/^[a-f0-9]{64}$/.test(group.sha256) || !Array.isArray(group.frameIds) || group.frameIds.length < 2 || new Set(group.frameIds).size !== group.frameIds.length)
          || JSON.stringify(review.groups) !== JSON.stringify(expectedGroups)) throw new Error('视觉请求重复截图确认回执无效。');
      }
      if (payload.similarFrameReview) {
        const review = payload.similarFrameReview;
        const confirmedAt = Date.parse(review.confirmedAt);
        const requestedAt = Date.parse(payload.requestedAt);
        const distance = (first: string, second: string) => Array.from(first).reduce((total, value, index) => total + [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4][Number.parseInt(value, 16) ^ Number.parseInt(second[index], 16)], 0);
        const expectedPairs = payload.frames.flatMap((first, firstIndex) => payload.frames.slice(firstIndex + 1).flatMap((second) => {
          if (!first.perceptualHash || !second.perceptualHash || first.sha256 === second.sha256) return [];
          const hammingDistance = distance(first.perceptualHash, second.perceptualHash);
          return hammingDistance <= review.maxHammingDistance ? [{ firstFrameId: first.id, secondFrameId: second.id, hammingDistance }] : [];
        }));
        if (review.confirmed !== true || !Number.isFinite(confirmedAt) || confirmedAt > requestedAt || !Number.isInteger(review.maxHammingDistance) || review.maxHammingDistance < 0 || review.maxHammingDistance > 64
          || !Array.isArray(review.pairs) || review.pairs.length < 1 || review.pairs.some((pair) => !pair.firstFrameId || !pair.secondFrameId || pair.firstFrameId === pair.secondFrameId || !Number.isInteger(pair.hammingDistance) || pair.hammingDistance < 0 || pair.hammingDistance > 64)
          || JSON.stringify(review.pairs) !== JSON.stringify(expectedPairs)) throw new Error('视觉请求相似截图确认回执无效。');
      }
      const requestFrames = new Map(payload.frames.map((frame) => [frame.id, frame.time]));
      if (visualEvidence.frames.some((frame) => !requestFrames.has(frame.id) || Math.abs((requestFrames.get(frame.id) as number) - frame.time) > 0.001)) throw new Error('候选证据图不属于视觉请求批次。');
    }
    if (!Array.isArray(visualEvidence.frames) || visualEvidence.frames.length < (visualEvidence.mode === 'cross-frame' ? 2 : 1) || visualEvidence.frames.length > 12
      || visualEvidence.frames.some((frame) => !frame.id || !Number.isFinite(frame.time) || frame.time < range.start || frame.time > range.end
        || !Number.isFinite(frame.windowStart) || !Number.isFinite(frame.windowEnd) || frame.windowStart > frame.time || frame.windowEnd < frame.time)) throw new Error('视觉证据截图范围无效。');
    if (!Number.isFinite(visualEvidence.confidence) || visualEvidence.confidence < 0 || visualEvidence.confidence > 1) throw new Error('视觉证据置信度无效。');
    if (visualEvidence.changeWindows) {
      const frameIds = new Set(visualEvidence.frames.map((frame) => frame.id));
      if (visualEvidence.mode !== 'cross-frame' || visualEvidence.changeWindows.length < 1
        || visualEvidence.changeWindows.some((window) => !frameIds.has(window.beforeFrameId) || !frameIds.has(window.afterFrameId)
          || !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start < range.start || window.end > range.end || window.end <= window.start
          || !['visible-change', 'possible-change', 'no-visible-change'].includes(window.assessment)
          || !Number.isFinite(window.confidence) || window.confidence < 0 || window.confidence > 1)) throw new Error('视觉变化区间回执无效。');
    }
    if (visualEvidence.refinementComparison) {
      const comparison = visualEvidence.refinementComparison;
      const validFields = new Set(['action', 'result', 'continuity', 'change-windows']);
      if (visualEvidence.analysisPass !== 'refinement' || !['consistent', 'changed'].includes(comparison.status)
        || !Array.isArray(comparison.changedFields) || comparison.changedFields.some((field) => !validFields.has(field))
        || (comparison.status === 'consistent') !== (comparison.changedFields.length === 0)
        || !comparison.initial.frameIds.length || !comparison.refined.frameIds.length
        || !Number.isFinite(comparison.initial.confidence) || comparison.initial.confidence < 0 || comparison.initial.confidence > 1
        || !Number.isFinite(comparison.refined.confidence) || comparison.refined.confidence < 0 || comparison.refined.confidence > 1) throw new Error('视觉补帧对照回执无效。');
      if (comparison.status === 'changed' && (!visualEvidence.refinementReview?.acknowledged
        || visualEvidence.refinementReview.resolution !== 'human-confirmed-final-fields'
        || !Number.isFinite(Date.parse(visualEvidence.refinementReview.reviewedAt)))) throw new Error('请先核对补帧前后的模型分歧，并确认人工最终字段。');
      if (comparison.status === 'consistent' && visualEvidence.refinementReview) throw new Error('无分歧的视觉回执不能伪造分歧确认。');
    } else if (visualEvidence.refinementReview) {
      throw new Error('视觉分歧确认缺少两轮对照。');
    }
  }
  const now = new Date().toISOString();
  const semantics: SourceActionSemantics = {
    subject: input.subject.trim(), action: input.action.trim(), object: input.object.trim(), result: input.result.trim(),
    shot: input.shot, tags: [...new Set(input.tags.split(/[,，、\n]/).map((tag) => tag.trim()).filter(Boolean))],
    method: 'human-observed', reviewedAt: now, sourceSignature: actionSourceSignature(source), ...range,
    ...(visualEvidence ? { visualEvidence: structuredClone(visualEvidence) } : {}),
  };
  return { id: `event-${crypto.randomUUID()}`, label: [semantics.subject, semantics.action, semantics.object, semantics.result].filter(Boolean).join(' · '),
    ...range, kind: input.kind, createdAt: now, visualConfirmed: true, semantics };
}
