import type { Asset, NarrationTrack } from '@/types';
import { uid } from './blockFactory';

/** 读取图片尺寸 */
function probeImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 960, height: 540 });
    img.src = url;
  });
}

/** 读取视频尺寸与时长 */
function probeVideo(url: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () =>
      resolve({
        width: v.videoWidth || 1280,
        height: v.videoHeight || 720,
        duration: Number.isFinite(v.duration) ? v.duration : 6,
      });
    v.onerror = () => resolve({ width: 1280, height: 720, duration: 6 });
    v.src = url;
  });
}

/**
 * 把 File 变成素材记录。
 * 素材转为 data URL，随工程一起保存与导出，刷新后仍可恢复。
 */
export async function fileToAsset(file: File): Promise<Asset | null> {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) return null;

  const url = await fileToDataUrl(file);
  const base = {
    id: uid('ast'),
    name: file.name,
    url,
    size: file.size,
  };

  if (isImage) {
    const { width, height } = await probeImage(url);
    return { ...base, kind: 'image', width, height };
  }
  const { width, height, duration } = await probeVideo(url);
  return { ...base, kind: 'video', width, height, duration };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export async function fileToNarration(file: File): Promise<NarrationTrack> {
  const src = await fileToDataUrl(file);
  const duration = await new Promise<number>((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => resolve(0);
    audio.src = src;
  });
  return {
    id: uid('aud'),
    name: file.name,
    src,
    duration,
    size: file.size,
  };
}

/** 打开系统文件选择器 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // 用户取消时 change 不触发，靠 focus 兜底避免 promise 永久挂起
    window.addEventListener(
      'focus',
      () => setTimeout(() => resolve(input.files?.[0] ?? null), 400),
      { once: true },
    );
    input.click();
  });
}

export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    window.addEventListener('focus', () => setTimeout(() => resolve(Array.from(input.files ?? [])), 400), { once: true });
    input.click();
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
