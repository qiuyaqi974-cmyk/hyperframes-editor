export interface SourceVisualCheckpointResult {
  image: string;
  times: number[];
  windowStart: number;
  windowEnd: number;
  cached: boolean;
}

function clamp(value: number, duration: number) {
  return Math.max(0, Math.min(value, Math.max(0, duration - 0.001)));
}

/** 三组连续帧：入点附近、正文中部、出点附近。只在用户请求时计算。 */
export function visualCheckpointTimes(start: number, end: number, duration: number, offset = 0.45) {
  const safeStart = clamp(start, duration);
  const safeEnd = clamp(Math.max(start, end), duration);
  const middle = (safeStart + safeEnd) / 2;
  const times = [safeStart, middle, safeEnd].flatMap((center) => [center - offset, center, center + offset].map((time) => clamp(time, duration)));
  return times.map((time) => Number(time.toFixed(3)));
}

export function waveformWindowPeaks(peaks: number[], duration: number, start: number, end: number, count = 90) {
  if (!peaks.length || duration <= 0 || end <= start) return [];
  const from = Math.max(0, Math.floor(start / duration * peaks.length));
  const to = Math.min(peaks.length, Math.max(from + 1, Math.ceil(end / duration * peaks.length)));
  const window = peaks.slice(from, to);
  const stride = Math.max(1, Math.ceil(window.length / count));
  return window.filter((_, index) => index % stride === 0).slice(0, count);
}
