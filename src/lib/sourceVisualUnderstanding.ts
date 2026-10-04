import type { SourceActionSemantics } from '@/types';
import type { SourceActionVisualRefinementComparison } from '@/types';

export interface VisualUnderstandingFrame {
  id: string;
  time: number;
  windowStart: number;
  windowEnd: number;
  image: string;
  transcript: string;
}

export interface VisualUnderstandingPayloadSummary {
  imageCount: number;
  imageBytes: number;
  transcriptCharacters: number;
  spanSeconds: number;
}

export interface VisualUnderstandingCoverageSummary {
  selectedCount: number;
  largestGap: { start: number; end: number; seconds: number };
}

export interface VisualUnderstandingCoverageOption {
  id: string;
  resultingLargestGapSeconds: number;
  addedImageCount: number;
  addedImageBytes: number;
}

export function recommendVisualUnderstandingCoverageOption(currentLargestGapSeconds: number, options: VisualUnderstandingCoverageOption[]) {
  if (!Number.isFinite(currentLargestGapSeconds) || currentLargestGapSeconds < 0) throw new Error('当前证据空档无效。');
  if (new Set(options.map((option) => option.id)).size !== options.length || options.some((option) => !option.id
    || !Number.isFinite(option.resultingLargestGapSeconds) || option.resultingLargestGapSeconds < 0
    || !Number.isInteger(option.addedImageCount) || option.addedImageCount < 0
    || !Number.isInteger(option.addedImageBytes) || option.addedImageBytes < 0)) throw new Error('证据批次比较数据无效。');
  const best = options.map((option, index) => ({ ...option, index }))
    .filter((option) => option.resultingLargestGapSeconds < currentLargestGapSeconds - 0.05)
    .sort((first, second) => first.resultingLargestGapSeconds - second.resultingLargestGapSeconds
      || first.addedImageCount - second.addedImageCount
      || first.addedImageBytes - second.addedImageBytes
      || first.index - second.index)[0];
  return best ? { ...best, gapReductionSeconds: currentLargestGapSeconds - best.resultingLargestGapSeconds } : undefined;
}

export function summarizeVisualUnderstandingCoverage(frames: Array<Pick<VisualUnderstandingFrame, 'id' | 'time'>>, duration: number): VisualUnderstandingCoverageSummary {
  if (!Number.isFinite(duration) || duration < 0) throw new Error('原片时长无效，无法计算证据空档。');
  if (new Set(frames.map((frame) => frame.id)).size !== frames.length || frames.some((frame) => !frame.id || !Number.isFinite(frame.time) || frame.time < 0 || frame.time > duration)) throw new Error('证据截图时间无效，无法计算空档。');
  const points = [0, ...frames.map((frame) => frame.time).sort((a, b) => a - b), duration];
  let largestGap = { start: 0, end: duration, seconds: duration };
  for (let index = 1; index < points.length; index += 1) {
    const gap = { start: points[index - 1], end: points[index], seconds: points[index] - points[index - 1] };
    if (gap.seconds > largestGap.seconds || index === 1) largestGap = gap;
  }
  return { selectedCount: frames.length, largestGap };
}

export function planVisualUnderstandingCoverageSelection(frames: Array<Pick<VisualUnderstandingFrame, 'id' | 'time'>>, selectedIds: string[], duration: number, targetCount: number, stopAtGapSeconds = 0) {
  summarizeVisualUnderstandingCoverage(frames, duration);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 12) throw new Error('证据空档补选目标必须是 1–12 张。');
  if (!Number.isFinite(stopAtGapSeconds) || stopAtGapSeconds < 0 || stopAtGapSeconds > 86400) throw new Error('证据空档秒数目标无效。');
  if (new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !frames.some((frame) => frame.id === id))) throw new Error('证据空档补选包含未知截图。');
  const selected = new Set(selectedIds);
  const before = summarizeVisualUnderstandingCoverage(frames.filter((frame) => selected.has(frame.id)), duration);
  const addedIds: string[] = [];
  let current = before;
  while (selected.size < Math.min(targetCount, frames.length) && current.largestGap.seconds > stopAtGapSeconds) {
    const best = frames.filter((frame) => !selected.has(frame.id)).map((frame, index) => ({
      frame,
      index,
      gap: summarizeVisualUnderstandingCoverage(frames.filter((item) => selected.has(item.id) || item.id === frame.id), duration).largestGap.seconds,
    })).sort((first, second) => first.gap - second.gap || first.index - second.index)[0];
    if (!best) break;
    selected.add(best.frame.id); addedIds.push(best.frame.id);
    current = summarizeVisualUnderstandingCoverage(frames.filter((frame) => selected.has(frame.id)), duration);
  }
  const plannedIds = frames.filter((frame) => selected.has(frame.id)).map((frame) => frame.id);
  return { selectedIds: plannedIds, addedIds, before, after: current };
}

export interface VisualUnderstandingFrameFingerprint {
  id: string;
  time: number;
  sha256: string;
  perceptualHash?: string;
}

export interface VisualUnderstandingDuplicateFrameGroup {
  sha256: string;
  frames: VisualUnderstandingFrameFingerprint[];
}

export interface VisualUnderstandingDuplicateFrameReview {
  confirmed: true;
  confirmedAt: string;
  groups: Array<{ sha256: string; frameIds: string[] }>;
}

export interface VisualUnderstandingSimilarFramePair {
  first: VisualUnderstandingFrameFingerprint;
  second: VisualUnderstandingFrameFingerprint;
  hammingDistance: number;
}

export interface VisualUnderstandingSimilarFrameReview {
  confirmed: true;
  confirmedAt: string;
  maxHammingDistance: number;
  pairs: Array<{ firstFrameId: string; secondFrameId: string; hammingDistance: number }>;
}

export function visualUnderstandingPerceptualHash(rgba: ArrayLike<number>, width = 9, height = 8) {
  if (width !== 9 || height !== 8 || rgba.length !== width * height * 4) throw new Error('感知哈希输入必须是 9×8 RGBA 像素。');
  let bits = '';
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width - 1; x += 1) {
    const offset = (y * width + x) * 4;
    const next = offset + 4;
    const luma = Number(rgba[offset]) * 299 + Number(rgba[offset + 1]) * 587 + Number(rgba[offset + 2]) * 114;
    const nextLuma = Number(rgba[next]) * 299 + Number(rgba[next + 1]) * 587 + Number(rgba[next + 2]) * 114;
    bits += luma > nextLuma ? '1' : '0';
  }
  return Array.from({ length: 16 }, (_, index) => Number.parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16)).join('');
}

export function visualUnderstandingPerceptualDistance(first: string, second: string) {
  if (!/^[a-f0-9]{16}$/.test(first) || !/^[a-f0-9]{16}$/.test(second)) throw new Error('感知哈希格式无效。');
  const bitCounts = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  return Array.from(first).reduce((total, value, index) => total + bitCounts[Number.parseInt(value, 16) ^ Number.parseInt(second[index], 16)], 0);
}

export interface VisualUnderstandingAdjacentFrameDifference {
  first: VisualUnderstandingFrameFingerprint;
  second: VisualUnderstandingFrameFingerprint;
  hammingDistance: number;
}

export function compareVisualUnderstandingAdjacentFrames(frames: VisualUnderstandingFrameFingerprint[]): VisualUnderstandingAdjacentFrameDifference[] {
  if (new Set(frames.map((frame) => frame.id)).size !== frames.length || frames.some((frame) => !frame.id || !Number.isFinite(frame.time) || !frame.perceptualHash)) throw new Error('相邻画面比较数据无效。');
  const ordered = frames.map((frame) => ({ ...frame })).sort((first, second) => first.time - second.time);
  if (ordered.some((frame, index) => index > 0 && frame.time <= ordered[index - 1].time)) throw new Error('相邻画面比较时间必须严格递增。');
  return ordered.slice(1).map((second, index) => {
    const first = ordered[index];
    return { first, second, hammingDistance: visualUnderstandingPerceptualDistance(first.perceptualHash!, second.perceptualHash!) };
  });
}

export function similarVisualUnderstandingFramePairs(frames: VisualUnderstandingFrameFingerprint[], maxHammingDistance = 4): VisualUnderstandingSimilarFramePair[] {
  if (!Number.isInteger(maxHammingDistance) || maxHammingDistance < 0 || maxHammingDistance > 64) throw new Error('感知哈希距离阈值无效。');
  const pairs: VisualUnderstandingSimilarFramePair[] = [];
  for (let firstIndex = 0; firstIndex < frames.length; firstIndex += 1) for (let secondIndex = firstIndex + 1; secondIndex < frames.length; secondIndex += 1) {
    const first = frames[firstIndex]; const second = frames[secondIndex];
    if (first.sha256 === second.sha256 || !first.perceptualHash || !second.perceptualHash) continue;
    const hammingDistance = visualUnderstandingPerceptualDistance(first.perceptualHash, second.perceptualHash);
    if (hammingDistance <= maxHammingDistance) pairs.push({ first: { ...first }, second: { ...second }, hammingDistance });
  }
  return pairs;
}

export function selectVisualUnderstandingRepresentatives(frameIds: string[], pairs: Array<{ firstFrameId: string; secondFrameId: string }>) {
  if (new Set(frameIds).size !== frameIds.length || frameIds.some((id) => !id)) throw new Error('代表帧建议的截图编号无效。');
  const positions = new Map(frameIds.map((id, index) => [id, index]));
  const kept = new Set(frameIds);
  pairs.forEach(({ firstFrameId, secondFrameId }) => {
    const firstIndex = positions.get(firstFrameId); const secondIndex = positions.get(secondFrameId);
    if (firstIndex === undefined || secondIndex === undefined || firstFrameId === secondFrameId) throw new Error('代表帧建议引用了未知或重复截图。');
    const earlier = firstIndex < secondIndex ? firstFrameId : secondFrameId;
    const later = firstIndex < secondIndex ? secondFrameId : firstFrameId;
    if (kept.has(earlier) && kept.has(later)) kept.delete(later);
  });
  return { keptIds: frameIds.filter((id) => kept.has(id)), removedIds: frameIds.filter((id) => !kept.has(id)) };
}

export function previewVisualUnderstandingRepresentativeSelection(frames: VisualUnderstandingFrame[], pairs: Array<{ firstFrameId: string; secondFrameId: string }>) {
  const selection = selectVisualUnderstandingRepresentatives(frames.map((frame) => frame.id), pairs);
  const before = summarizeVisualUnderstandingPayload(frames);
  const after = summarizeVisualUnderstandingPayload(frames.filter((frame) => selection.keptIds.includes(frame.id)));
  return {
    ...selection,
    before,
    after,
    saved: {
      imageCount: before.imageCount - after.imageCount,
      imageBytes: before.imageBytes - after.imageBytes,
      transcriptCharacters: before.transcriptCharacters - after.transcriptCharacters,
    },
  };
}

export async function addVisualUnderstandingPerceptualHashes(frames: VisualUnderstandingFrame[], fingerprints: VisualUnderstandingFrameFingerprint[]) {
  if (frames.length !== fingerprints.length || typeof document === 'undefined') throw new Error('无法为当前截图计算本地感知哈希。');
  return Promise.all(frames.map(async (frame, index) => {
    const image = new Image();
    image.src = frame.image;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 9; canvas.height = 8;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法读取截图像素以计算感知哈希。');
    context.drawImage(image, 0, 0, 9, 8);
    return { ...fingerprints[index], perceptualHash: visualUnderstandingPerceptualHash(context.getImageData(0, 0, 9, 8).data) };
  }));
}

export function duplicateVisualUnderstandingFrameGroups(frames: VisualUnderstandingFrameFingerprint[]): VisualUnderstandingDuplicateFrameGroup[] {
  const groups = new Map<string, VisualUnderstandingFrameFingerprint[]>();
  frames.forEach((frame) => groups.set(frame.sha256, [...(groups.get(frame.sha256) ?? []), frame]));
  return [...groups.entries()].filter(([, items]) => items.length > 1).map(([sha256, items]) => ({ sha256, frames: items.map((frame) => ({ ...frame })) }));
}

export interface VisualUnderstandingSessionBudget {
  maxRequests: number;
  maxImages: number;
  maxImageBytes: number;
  maxReportedTokensPerModel: number;
}

export interface VisualUnderstandingSessionUsage {
  requests: number;
  imageCount: number;
  imageBytes: number;
  transcriptCharacters: number;
}

export interface VisualUnderstandingTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface VisualUnderstandingTokenUsageBucket extends VisualUnderstandingTokenUsage {
  providerId: string;
  provider: string;
  model: string;
  reportedRequests: number;
}

export interface VisualUnderstandingRequestRecord {
  requestId: string;
  requestedAt: string;
  completedAt: string;
  providerId: string;
  provider: string;
  model: string;
  pass: 'initial' | 'refinement';
  sessionRequestNumber: number;
  payload: VisualUnderstandingPayloadSummary;
  frames: VisualUnderstandingFrameFingerprint[];
  duplicateFrameReview?: VisualUnderstandingDuplicateFrameReview;
  similarFrameReview?: VisualUnderstandingSimilarFrameReview;
  status: 'succeeded' | 'failed';
  tokenUsage?: VisualUnderstandingTokenUsage;
  error?: string;
}

export interface VisualUnderstandingRequestLog {
  format: 'hyperframes-visual-request-log-v1';
  exportedAt: string;
  recordsSha256: string;
  records: VisualUnderstandingRequestRecord[];
}

async function visualRequestRecordsSha256(records: unknown) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(records)));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function createVisualUnderstandingRequestLog(records: VisualUnderstandingRequestRecord[], exportedAt = new Date().toISOString()): Promise<VisualUnderstandingRequestLog> {
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error('视觉请求记录导出时间无效。');
  const snapshot = structuredClone(records);
  const recordsSha256 = await visualRequestRecordsSha256(snapshot);
  return { format: 'hyperframes-visual-request-log-v1', exportedAt, recordsSha256, records: snapshot };
}

const hasExactKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key)) && allowed.filter((key) => !['tokenUsage', 'error', 'duplicateFrameReview', 'similarFrameReview', 'perceptualHash'].includes(key)).every((key) => key in value);
const isNonNegativeInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;

export async function verifyVisualUnderstandingRequestLog(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('视觉请求记录必须是 JSON 对象。');
  const root = input as Record<string, unknown>;
  if (!hasExactKeys(root, ['format', 'exportedAt', 'recordsSha256', 'records'])) throw new Error('视觉请求记录顶层字段缺失或包含未知字段。');
  if (root.format !== 'hyperframes-visual-request-log-v1') throw new Error('视觉请求记录版本不支持。');
  if (typeof root.exportedAt !== 'string' || !Number.isFinite(Date.parse(root.exportedAt))) throw new Error('视觉请求记录导出时间无效。');
  if (typeof root.recordsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(root.recordsSha256)) throw new Error('视觉请求记录哈希格式无效。');
  if (!Array.isArray(root.records) || root.records.length > 100) throw new Error('视觉请求记录列表无效或超过 100 条。');
  const requestIds = new Set<string>();
  let previousSessionRequestNumber = 0;
  let failedCount = 0;
  let reportedTokenRequests = 0;
  root.records.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`第 ${index + 1} 条视觉请求不是对象。`);
    const record = value as Record<string, unknown>;
    if (!hasExactKeys(record, ['requestId', 'requestedAt', 'completedAt', 'providerId', 'provider', 'model', 'pass', 'sessionRequestNumber', 'payload', 'frames', 'duplicateFrameReview', 'similarFrameReview', 'status', 'tokenUsage', 'error'])) throw new Error(`第 ${index + 1} 条视觉请求字段缺失或包含未知字段。`);
    if (typeof record.requestId !== 'string' || !record.requestId || record.requestId.length > 160 || requestIds.has(record.requestId)) throw new Error(`第 ${index + 1} 条视觉请求批次无效或重复。`);
    requestIds.add(record.requestId);
    const requestedTime = typeof record.requestedAt === 'string' ? Date.parse(record.requestedAt) : NaN;
    const completedTime = typeof record.completedAt === 'string' ? Date.parse(record.completedAt) : NaN;
    if (!Number.isFinite(requestedTime) || !Number.isFinite(completedTime) || completedTime < requestedTime) throw new Error(`第 ${index + 1} 条视觉请求时间无效。`);
    if (![record.providerId, record.provider, record.model].every((item) => typeof item === 'string' && item.length > 0)) throw new Error(`第 ${index + 1} 条视觉请求模型信息无效。`);
    if (!['initial', 'refinement'].includes(String(record.pass))) throw new Error(`第 ${index + 1} 条视觉请求轮次无效。`);
    if (!Number.isSafeInteger(record.sessionRequestNumber) || Number(record.sessionRequestNumber) <= previousSessionRequestNumber) throw new Error('视觉请求会话序号必须严格递增。');
    previousSessionRequestNumber = Number(record.sessionRequestNumber);
    if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) throw new Error(`第 ${index + 1} 条视觉请求负载无效。`);
    const payload = record.payload as Record<string, unknown>;
    if (!hasExactKeys(payload, ['imageCount', 'imageBytes', 'transcriptCharacters', 'spanSeconds'])
      || !Number.isSafeInteger(payload.imageCount) || Number(payload.imageCount) < 1 || Number(payload.imageCount) > 12
      || !Number.isSafeInteger(payload.imageBytes) || Number(payload.imageBytes) < 1
      || !isNonNegativeInteger(payload.transcriptCharacters) || typeof payload.spanSeconds !== 'number' || !Number.isFinite(payload.spanSeconds) || payload.spanSeconds < 0) throw new Error(`第 ${index + 1} 条视觉请求负载字段无效。`);
    if (!Array.isArray(record.frames) || record.frames.length !== payload.imageCount) throw new Error(`第 ${index + 1} 条视觉请求帧数量无效。`);
    const frameIds = new Set<string>();
    record.frames.forEach((frameValue) => {
      if (!frameValue || typeof frameValue !== 'object' || Array.isArray(frameValue)) throw new Error(`第 ${index + 1} 条视觉请求帧无效。`);
      const frame = frameValue as Record<string, unknown>;
      if (!hasExactKeys(frame, ['id', 'time', 'sha256', 'perceptualHash']) || typeof frame.id !== 'string' || !frame.id || frameIds.has(frame.id)
        || typeof frame.time !== 'number' || !Number.isFinite(frame.time) || typeof frame.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(frame.sha256)
        || frame.perceptualHash !== undefined && (typeof frame.perceptualHash !== 'string' || !/^[a-f0-9]{16}$/.test(frame.perceptualHash))) throw new Error(`第 ${index + 1} 条视觉请求帧字段无效。`);
      frameIds.add(frame.id);
    });
    if (record.duplicateFrameReview !== undefined) {
      if (!record.duplicateFrameReview || typeof record.duplicateFrameReview !== 'object' || Array.isArray(record.duplicateFrameReview)) throw new Error(`第 ${index + 1} 条视觉请求重复截图确认无效。`);
      const review = record.duplicateFrameReview as Record<string, unknown>;
      const confirmedTime = typeof review.confirmedAt === 'string' ? Date.parse(review.confirmedAt) : NaN;
      if (!hasExactKeys(review, ['confirmed', 'confirmedAt', 'groups']) || review.confirmed !== true || !Number.isFinite(confirmedTime) || confirmedTime > requestedTime || !Array.isArray(review.groups) || review.groups.length < 1) throw new Error(`第 ${index + 1} 条视觉请求重复截图确认字段无效。`);
      const expectedGroups = duplicateVisualUnderstandingFrameGroups(record.frames as VisualUnderstandingFrameFingerprint[]).map((group) => ({ sha256: group.sha256, frameIds: group.frames.map((frame) => frame.id) }));
      const seenHashes = new Set<string>();
      const actualGroups = review.groups.map((groupValue) => {
        if (!groupValue || typeof groupValue !== 'object' || Array.isArray(groupValue)) throw new Error(`第 ${index + 1} 条视觉请求重复截图分组无效。`);
        const group = groupValue as Record<string, unknown>;
        if (!hasExactKeys(group, ['sha256', 'frameIds']) || typeof group.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(group.sha256) || seenHashes.has(group.sha256)
          || !Array.isArray(group.frameIds) || group.frameIds.length < 2 || group.frameIds.some((id) => typeof id !== 'string') || new Set(group.frameIds).size !== group.frameIds.length) throw new Error(`第 ${index + 1} 条视觉请求重复截图分组字段无效。`);
        seenHashes.add(group.sha256);
        return { sha256: group.sha256, frameIds: group.frameIds };
      });
      if (JSON.stringify(actualGroups) !== JSON.stringify(expectedGroups)) throw new Error(`第 ${index + 1} 条视觉请求重复截图确认与帧指纹不一致。`);
    }
    if (record.similarFrameReview !== undefined) {
      if (!record.similarFrameReview || typeof record.similarFrameReview !== 'object' || Array.isArray(record.similarFrameReview)) throw new Error(`第 ${index + 1} 条视觉请求相似截图确认无效。`);
      const review = record.similarFrameReview as Record<string, unknown>;
      const confirmedTime = typeof review.confirmedAt === 'string' ? Date.parse(review.confirmedAt) : NaN;
      if (!hasExactKeys(review, ['confirmed', 'confirmedAt', 'maxHammingDistance', 'pairs']) || review.confirmed !== true || !Number.isFinite(confirmedTime) || confirmedTime > requestedTime
        || !Number.isInteger(review.maxHammingDistance) || Number(review.maxHammingDistance) < 0 || Number(review.maxHammingDistance) > 64 || !Array.isArray(review.pairs) || review.pairs.length < 1) throw new Error(`第 ${index + 1} 条视觉请求相似截图确认字段无效。`);
      const expectedPairs = similarVisualUnderstandingFramePairs(record.frames as VisualUnderstandingFrameFingerprint[], Number(review.maxHammingDistance)).map((pair) => ({ firstFrameId: pair.first.id, secondFrameId: pair.second.id, hammingDistance: pair.hammingDistance }));
      const actualPairs = review.pairs.map((pairValue) => {
        if (!pairValue || typeof pairValue !== 'object' || Array.isArray(pairValue)) throw new Error(`第 ${index + 1} 条视觉请求相似截图配对无效。`);
        const pair = pairValue as Record<string, unknown>;
        if (!hasExactKeys(pair, ['firstFrameId', 'secondFrameId', 'hammingDistance']) || typeof pair.firstFrameId !== 'string' || typeof pair.secondFrameId !== 'string'
          || pair.firstFrameId === pair.secondFrameId || !Number.isInteger(pair.hammingDistance) || Number(pair.hammingDistance) < 0 || Number(pair.hammingDistance) > 64) throw new Error(`第 ${index + 1} 条视觉请求相似截图配对字段无效。`);
        return { firstFrameId: pair.firstFrameId, secondFrameId: pair.secondFrameId, hammingDistance: pair.hammingDistance };
      });
      if (JSON.stringify(actualPairs) !== JSON.stringify(expectedPairs)) throw new Error(`第 ${index + 1} 条视觉请求相似截图确认与感知哈希不一致。`);
    }
    if (!['succeeded', 'failed'].includes(String(record.status))) throw new Error(`第 ${index + 1} 条视觉请求状态无效。`);
    if (record.tokenUsage !== undefined) {
      if (!record.tokenUsage || typeof record.tokenUsage !== 'object' || Array.isArray(record.tokenUsage)) throw new Error(`第 ${index + 1} 条视觉请求 Token 无效。`);
      const usage = record.tokenUsage as Record<string, unknown>;
      if (!hasExactKeys(usage, ['inputTokens', 'outputTokens', 'totalTokens']) || !isNonNegativeInteger(usage.inputTokens) || !isNonNegativeInteger(usage.outputTokens)
        || !isNonNegativeInteger(usage.totalTokens) || Number(usage.totalTokens) !== Number(usage.inputTokens) + Number(usage.outputTokens)) throw new Error(`第 ${index + 1} 条视觉请求 Token 字段无效。`);
      reportedTokenRequests += 1;
    }
    if (record.status === 'succeeded' && record.error !== undefined) throw new Error(`第 ${index + 1} 条成功请求不能包含错误。`);
    if (record.status === 'failed') {
      failedCount += 1;
      if (typeof record.error !== 'string' || !record.error.trim() || record.tokenUsage !== undefined) throw new Error(`第 ${index + 1} 条失败请求回执无效。`);
    }
  });
  const calculatedSha256 = await visualRequestRecordsSha256(root.records);
  if (calculatedSha256 !== root.recordsSha256) throw new Error('视觉请求记录内容哈希不匹配。');
  return { valid: true as const, recordCount: root.records.length, failedCount, reportedTokenRequests, recordsSha256: calculatedSha256 };
}

export function addVisualUnderstandingTokenUsage(
  buckets: VisualUnderstandingTokenUsageBucket[],
  identity: Pick<VisualUnderstandingTokenUsageBucket, 'providerId' | 'provider' | 'model'>,
  usage: VisualUnderstandingTokenUsage,
): VisualUnderstandingTokenUsageBucket[] {
  const index = buckets.findIndex((bucket) => bucket.providerId === identity.providerId && bucket.model === identity.model);
  if (index < 0) return [...buckets, { ...identity, reportedRequests: 1, ...usage }];
  return buckets.map((bucket, current) => current === index ? {
    ...bucket,
    provider: identity.provider,
    reportedRequests: bucket.reportedRequests + 1,
    inputTokens: bucket.inputTokens + usage.inputTokens,
    outputTokens: bucket.outputTokens + usage.outputTokens,
    totalTokens: bucket.totalTokens + usage.totalTokens,
  } : bucket);
}

export interface VisualUnderstandingCandidate {
  frameId: string;
  subject: string;
  action: string;
  object: string;
  result: string;
  shot: SourceActionSemantics['shot'];
  tags: string[];
  uncertainty: string;
  confidence: number;
}

export interface VisualUnderstandingSequenceCandidate {
  frameIds: string[];
  subject: string;
  action: string;
  object: string;
  result: string;
  shot: SourceActionSemantics['shot'];
  tags: string[];
  continuity: 'state-change' | 'possible-continuation' | 'uncertain';
  evidence: string;
  uncertainty: string;
  confidence: number;
  changeWindows: VisualUnderstandingChangeWindow[];
}

export interface VisualUnderstandingChangeWindow {
  beforeFrameId: string;
  afterFrameId: string;
  assessment: 'visible-change' | 'possible-change' | 'no-visible-change';
  evidence: string;
  uncertainty: string;
  confidence: number;
}

export interface VisualUnderstandingResult {
  candidates: VisualUnderstandingCandidate[];
  sequences?: VisualUnderstandingSequenceCandidate[];
  model: string;
  imageCount: number;
  providerId?: string;
  provider?: string;
  /** 模型服务响应中实际报告的用量；服务未返回时保持缺失。 */
  tokenUsage?: VisualUnderstandingTokenUsage;
}

export interface VisualUnderstandingProviderCapability {
  id: 'openai' | 'local-openai';
  provider: string;
  model: string;
  available: boolean;
  local: boolean;
  endpoint?: string;
  configurationError?: string;
  status: 'configured' | 'not-configured';
}

export interface VisualUnderstandingCapabilities {
  available: boolean;
  provider: string;
  model: string;
  defaultProviderId?: VisualUnderstandingProviderCapability['id'];
  providers: VisualUnderstandingProviderCapability[];
}

export interface VisualUnderstandingProviderProbe {
  providerId: VisualUnderstandingProviderCapability['id'];
  ok: boolean;
  message: string;
  model: string;
  modelFound?: boolean;
}

const shots = new Set(['unspecified', 'wide', 'medium', 'closeup', 'detail']);

export function summarizeVisualUnderstandingPayload(frames: VisualUnderstandingFrame[]): VisualUnderstandingPayloadSummary {
  if (!frames.length) return { imageCount: 0, imageBytes: 0, transcriptCharacters: 0, spanSeconds: 0 };
  const imageBytes = frames.reduce((total, frame) => {
    const base64 = frame.image.slice(frame.image.indexOf(',') + 1);
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return total + Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
  }, 0);
  return {
    imageCount: frames.length,
    imageBytes,
    transcriptCharacters: frames.reduce((total, frame) => total + Array.from(frame.transcript).length, 0),
    spanSeconds: Math.max(...frames.map((frame) => frame.windowEnd)) - Math.min(...frames.map((frame) => frame.windowStart)),
  };
}

/** 对实际发送的 JPEG 解码字节取指纹；不保留或返回图片正文。 */
export async function fingerprintVisualUnderstandingFrames(frames: VisualUnderstandingFrame[]): Promise<VisualUnderstandingFrameFingerprint[]> {
  return Promise.all(frames.map(async (frame) => {
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(frame.image);
    if (!match) throw new Error('只允许为本地生成的 JPEG 截图计算指纹。');
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    return { id: frame.id, time: frame.time, sha256 };
  }));
}

export function visualUnderstandingBudgetViolations(usage: VisualUnderstandingSessionUsage, payload: VisualUnderstandingPayloadSummary, budget: VisualUnderstandingSessionBudget) {
  const violations: string[] = [];
  if (usage.requests + 1 > budget.maxRequests) violations.push(`请求次数将超过 ${budget.maxRequests} 次`);
  if (usage.imageCount + payload.imageCount > budget.maxImages) violations.push(`图片数量将超过 ${budget.maxImages} 张`);
  if (usage.imageBytes + payload.imageBytes > budget.maxImageBytes) violations.push(`图片负载将超过 ${(budget.maxImageBytes / 1024 / 1024).toFixed(1)} MB`);
  return violations;
}

export function visualUnderstandingTokenStop(
  buckets: VisualUnderstandingTokenUsageBucket[], providerId: string, model: string, maxReportedTokensPerModel: number,
) {
  const bucket = buckets.find((item) => item.providerId === providerId && item.model === model);
  if (!bucket || bucket.totalTokens < maxReportedTokensPerModel) return '';
  return `${bucket.provider} / ${bucket.model} 已报告 ${bucket.totalTokens} token，达到单模型停止线 ${maxReportedTokensPerModel}`;
}

export function validateVisualUnderstandingFrames(frames: VisualUnderstandingFrame[]) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 12) throw new Error('每次只能分析 1–12 张截图。');
  const ids = new Set<string>();
  let bytes = 0;
  let previousTime = -1;
  for (const frame of frames) {
    if (!frame.id || ids.has(frame.id)) throw new Error('截图编号缺失或重复。');
    ids.add(frame.id);
    if (!Number.isFinite(frame.time) || !Number.isFinite(frame.windowStart) || !Number.isFinite(frame.windowEnd)
      || frame.windowStart < 0 || frame.time < frame.windowStart || frame.time > frame.windowEnd) throw new Error('截图时间范围无效。');
    if (frame.time <= previousTime) throw new Error('截图必须按时间严格递增排列。');
    previousTime = frame.time;
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(frame.image)) throw new Error('只允许上传本地生成的 JPEG 截图。');
    bytes += frame.image.length;
    if (frame.transcript.length > 4000) throw new Error('单个时间窗的口播文本过长。');
  }
  if (bytes > 8 * 1024 * 1024) throw new Error('本次截图数据超过 8 MB，请减少选择数量。');
}

export function normalizeVisualUnderstandingCandidates(raw: unknown, frames: VisualUnderstandingFrame[]): VisualUnderstandingCandidate[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { candidates?: unknown }).candidates)) throw new Error('视觉模型返回格式无效。');
  const allowed = new Set(frames.map((frame) => frame.id));
  const seen = new Set<string>();
  return (raw as { candidates: unknown[] }).candidates.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('视觉候选不是对象。');
    const row = item as Record<string, unknown>;
    const frameId = String(row.frameId ?? '');
    if (!allowed.has(frameId) || seen.has(frameId)) throw new Error('视觉候选引用了未知或重复截图。');
    seen.add(frameId);
    const shot = String(row.shot ?? 'unspecified');
    if (!shots.has(shot)) throw new Error('视觉候选景别无效。');
    const confidence = Number(row.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('视觉候选置信度无效。');
    return {
      frameId,
      subject: String(row.subject ?? '').trim().slice(0, 120),
      action: String(row.action ?? '').trim().slice(0, 160),
      object: String(row.object ?? '').trim().slice(0, 120),
      result: String(row.result ?? '').trim().slice(0, 160),
      shot: shot as SourceActionSemantics['shot'],
      tags: Array.isArray(row.tags) ? [...new Set(row.tags.map(String).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12) : [],
      uncertainty: String(row.uncertainty ?? '').trim().slice(0, 240),
      confidence,
    };
  });
}

export function normalizeVisualUnderstandingSequences(raw: unknown, frames: VisualUnderstandingFrame[]): VisualUnderstandingSequenceCandidate[] {
  if (!raw || typeof raw !== 'object') throw new Error('视觉模型返回格式无效。');
  const sequences = (raw as { sequences?: unknown }).sequences;
  if (sequences === undefined) return [];
  if (!Array.isArray(sequences)) throw new Error('跨帧候选格式无效。');
  const positions = new Map(frames.map((frame, index) => [frame.id, index]));
  const seen = new Set<string>();
  return sequences.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('跨帧候选不是对象。');
    const row = item as Record<string, unknown>;
    const frameIds = Array.isArray(row.frameIds) ? row.frameIds.map(String) : [];
    if (frameIds.length < 2 || frameIds.length > 4 || new Set(frameIds).size !== frameIds.length) throw new Error('跨帧候选必须引用 2–4 张不同截图。');
    const indexes = frameIds.map((id) => positions.get(id));
    if (indexes.some((index) => index === undefined)) throw new Error('跨帧候选引用了未知截图。');
    if (!indexes.every((index, offset) => offset === 0 || index === (indexes[offset - 1] as number) + 1)) throw new Error('跨帧候选只能引用按时间连续选择的截图。');
    const key = frameIds.join('|');
    if (seen.has(key)) throw new Error('跨帧候选重复。');
    seen.add(key);
    const first = frames[indexes[0] as number];
    const last = frames[indexes[indexes.length - 1] as number];
    if (last.windowEnd - first.windowStart > 120) throw new Error('跨帧候选跨度不能超过 120 秒。');
    const shot = String(row.shot ?? 'unspecified');
    if (!shots.has(shot)) throw new Error('跨帧候选景别无效。');
    const continuity = String(row.continuity ?? 'uncertain');
    if (!['state-change', 'possible-continuation', 'uncertain'].includes(continuity)) throw new Error('跨帧候选连续性类型无效。');
    const confidence = Number(row.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('跨帧候选置信度无效。');
    if (!Array.isArray(row.changeWindows) || row.changeWindows.length !== frameIds.length - 1) throw new Error('跨帧候选必须逐一说明每个相邻截图区间。');
    const changeWindows = row.changeWindows.map((item, index) => {
      if (!item || typeof item !== 'object') throw new Error('变化区间不是对象。');
      const window = item as Record<string, unknown>;
      const beforeFrameId = String(window.beforeFrameId ?? '');
      const afterFrameId = String(window.afterFrameId ?? '');
      if (beforeFrameId !== frameIds[index] || afterFrameId !== frameIds[index + 1]) throw new Error('变化区间必须按候选中的相邻截图顺序排列。');
      const assessment = String(window.assessment ?? '');
      if (!['visible-change', 'possible-change', 'no-visible-change'].includes(assessment)) throw new Error('变化区间判断无效。');
      const windowConfidence = Number(window.confidence);
      if (!Number.isFinite(windowConfidence) || windowConfidence < 0 || windowConfidence > 1) throw new Error('变化区间置信度无效。');
      return {
        beforeFrameId,
        afterFrameId,
        assessment: assessment as VisualUnderstandingChangeWindow['assessment'],
        evidence: String(window.evidence ?? '').trim().slice(0, 240),
        uncertainty: String(window.uncertainty ?? '').trim().slice(0, 240),
        confidence: windowConfidence,
      };
    });
    if (continuity === 'state-change' && !changeWindows.some((window) => window.assessment === 'visible-change')) throw new Error('状态变化候选至少需要一个可见变化区间。');
    return {
      frameIds,
      subject: String(row.subject ?? '').trim().slice(0, 120),
      action: String(row.action ?? '').trim().slice(0, 160),
      object: String(row.object ?? '').trim().slice(0, 120),
      result: String(row.result ?? '').trim().slice(0, 160),
      shot: shot as SourceActionSemantics['shot'],
      tags: Array.isArray(row.tags) ? [...new Set(row.tags.map(String).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12) : [],
      continuity: continuity as VisualUnderstandingSequenceCandidate['continuity'],
      evidence: String(row.evidence ?? '').trim().slice(0, 320),
      uncertainty: String(row.uncertainty ?? '').trim().slice(0, 320),
      confidence,
      changeWindows,
    };
  });
}

/** 比较两轮模型原始结论；不判断哪一轮更正确，也不读取人工编辑后的字段。 */
export function compareVisualUnderstandingSequences(initial: VisualUnderstandingSequenceCandidate, refined: VisualUnderstandingSequenceCandidate): SourceActionVisualRefinementComparison {
  const changedFields: SourceActionVisualRefinementComparison['changedFields'] = [];
  if (initial.action !== refined.action) changedFields.push('action');
  if (initial.result !== refined.result) changedFields.push('result');
  if (initial.continuity !== refined.continuity) changedFields.push('continuity');
  const initialAssessments = initial.changeWindows.map((window) => window.assessment);
  const refinedAssessments = refined.changeWindows.map((window) => window.assessment);
  if (initialAssessments.length !== refinedAssessments.length || initialAssessments.some((assessment, index) => assessment !== refinedAssessments[index])) changedFields.push('change-windows');
  const snapshot = (sequence: VisualUnderstandingSequenceCandidate) => ({
    frameIds: [...sequence.frameIds],
    action: sequence.action,
    result: sequence.result,
    continuity: sequence.continuity,
    changeWindowAssessments: sequence.changeWindows.map((window) => window.assessment),
    confidence: sequence.confidence,
  });
  return { status: changedFields.length ? 'changed' : 'consistent', changedFields, initial: snapshot(initial), refined: snapshot(refined) };
}
