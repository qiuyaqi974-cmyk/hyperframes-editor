export interface VisualIndexSample {
  time: number;
  windowStart: number;
  windowEnd: number;
  reason: 'change' | 'coverage';
}

export interface VisualIndexFrame extends VisualIndexSample {
  image: string;
}

export interface SourceVisualIndexResult {
  frames: VisualIndexFrame[];
  detectedChanges: number;
  sampledChanges: number;
  interval: number;
  cached: boolean;
}

/** Every window gets one frame; a nearby detected cut takes priority over a blind midpoint. */
export function selectVisualIndexSamples(duration: number, changes: number[], maxFrames = 24, preferredInterval = 30): VisualIndexSample[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('视频时长无效。');
  if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 60) throw new Error('截图预算必须在 1–60 张之间。');
  if (!Number.isFinite(preferredInterval) || preferredInterval < 1 || preferredInterval > 120) throw new Error('期望间隔必须在 1–120 秒之间。');
  const interval = Math.max(preferredInterval, duration / maxFrames);
  const count = Math.min(maxFrames, Math.ceil(duration / interval));
  const cuts = [...new Set(changes.filter((time) => Number.isFinite(time) && time > 0 && time < duration).map((time) => Number(time.toFixed(3))))].sort((a, b) => a - b);
  return Array.from({ length: count }, (_, index) => {
    const windowStart = index * duration / count;
    const windowEnd = (index + 1) * duration / count;
    const midpoint = (windowStart + windowEnd) / 2;
    const nearby = cuts.filter((time) => time >= windowStart && time < windowEnd);
    const cut = nearby.sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint))[0];
    // Sample shortly after a cut so sub-second actions are less likely to end before the representative frame.
    const time = cut === undefined ? midpoint : Math.min(windowEnd - 0.01, cut + Math.min(0.25, (windowEnd - cut) / 2));
    return { time: Number(time.toFixed(3)), windowStart: Number(windowStart.toFixed(3)), windowEnd: Number(windowEnd.toFixed(3)), reason: cut === undefined ? 'coverage' : 'change' };
  });
}

/** 在人工指定的短区间内均匀补抽中间帧；不重复首尾证据，不扫描区间外素材。 */
export function selectVisualRefinementSamples(start: number, end: number, maxFrames = 6): VisualIndexSample[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.2 || end - start > 120) throw new Error('补帧区间必须在 0.2–120 秒之间。');
  if (!Number.isInteger(maxFrames) || maxFrames < 2 || maxFrames > 10) throw new Error('补帧预算必须在 2–10 张之间。');
  const step = (end - start) / (maxFrames + 1);
  const times = Array.from({ length: maxFrames }, (_, index) => start + step * (index + 1));
  return times.map((time, index) => ({
    time: Number(time.toFixed(3)),
    windowStart: Number((index === 0 ? start : (times[index - 1] + time) / 2).toFixed(3)),
    windowEnd: Number((index === times.length - 1 ? end : (time + times[index + 1]) / 2).toFixed(3)),
    reason: 'coverage',
  }));
}

/** 在模型图片额度内保留首尾上下文，并优先选择分散的本地变化点。只返回选择建议，不读取或发送图片。 */
export function selectVisualAnalysisFrames<T extends VisualIndexSample>(frames: T[], maxFrames: number): T[] {
  if (!Number.isInteger(maxFrames) || maxFrames < 0 || maxFrames > 12) throw new Error('单次分析截图预算必须在 0–12 张之间。');
  if (maxFrames === 0 || frames.length === 0) return [];
  const ordered = [...frames].sort((a, b) => a.time - b.time);
  if (ordered.length <= maxFrames) return ordered;
  const midpoint = (ordered[0].time + ordered[ordered.length - 1].time) / 2;
  if (maxFrames === 1) {
    const changes = ordered.filter((frame) => frame.reason === 'change');
    const pool = changes.length ? changes : ordered;
    return [pool.reduce((best, frame) => Math.abs(frame.time - midpoint) < Math.abs(best.time - midpoint) ? frame : best)];
  }
  const selected = new Set<T>([ordered[0], ordered[ordered.length - 1]]);
  const span = Math.max(0.001, ordered[ordered.length - 1].time - ordered[0].time);
  while (selected.size < maxFrames) {
    let best: T | undefined;
    let bestScore = -1;
    for (const frame of ordered) {
      if (selected.has(frame)) continue;
      const distance = Math.min(...[...selected].map((chosen) => Math.abs(chosen.time - frame.time))) / span;
      const score = distance + (frame.reason === 'change' ? 0.35 : 0);
      if (score > bestScore) { best = frame; bestScore = score; }
    }
    if (!best) break;
    selected.add(best);
  }
  return [...selected].sort((a, b) => a.time - b.time);
}

/** 为第二轮分析预留原候选证据帧后，计算可补抽的中间帧数；少于 2 张时不形成补帧复核。 */
export function selectVisualRefinementBudget(remainingImages: number, endpointFrames: number, preferredFrames = 6) {
  if (!Number.isInteger(remainingImages) || remainingImages < 0) throw new Error('剩余图片预算无效。');
  if (!Number.isInteger(endpointFrames) || endpointFrames < 2 || endpointFrames > 4) throw new Error('跨帧证据数量必须在 2–4 张之间。');
  if (!Number.isInteger(preferredFrames) || preferredFrames < 2 || preferredFrames > 10) throw new Error('补帧偏好必须在 2–10 张之间。');
  const available = Math.min(preferredFrames, remainingImages - endpointFrames);
  return available >= 2 ? available : 0;
}
