import type { Scene } from '@/types';

function parseTime(value: string): number {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function parseSrt(input: string): Scene[] {
  const normalized = input.replace(/\r/g, '').trim();
  if (!normalized) return [];

  return normalized
    .split(/\n{2,}/)
    .map((chunk, index) => {
      const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex < 0) return null;
      const [from, to] = lines[timingIndex].split('-->').map((part) => part.trim().split(' ')[0]);
      const start = parseTime(from);
      const end = parseTime(to);
      const text = lines.slice(timingIndex + 1).join('\n').trim();
      if (!text || end <= start) return null;
      return {
        id: `scene_${String(index + 1).padStart(3, '0')}`,
        index: index + 1,
        start,
        end,
        duration: end - start,
        text,
      } satisfies Scene;
    })
    .filter((scene): scene is Scene => Boolean(scene));
}
