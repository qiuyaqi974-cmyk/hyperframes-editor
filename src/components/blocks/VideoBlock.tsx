import { useEffect, useRef, useState } from 'react';
import type { EvaluatedFrame, VideoBlockData } from '@/types';
import { usePlaybackState } from '@/render/playback';

interface Props {
  block: VideoBlockData;
  frame: EvaluatedFrame;
  width: number;
  height: number;
}

/**
 * 视频积木。
 *
 * 关键：**播放权归播放头，不归 <video> 自己。**
 * 这是 HyperFrames 「媒体播放由框架托管」那条契约的直接落地——
 * 只有这样，暂停/拖动进度条时画面才与时间轴严格对齐，
 * 将来逐帧导出也不会出现音画漂移。
 */
export default function VideoBlock({ block, frame, width, height }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const isPlaying = usePlaybackState();
  const { props } = block;
  const [resolvedSrc, setResolvedSrc] = useState(props.src);
  const isLocalPath = Boolean(props.src && (/^file:\/\//i.test(props.src) || /^[A-Za-z]:[\\/]/.test(props.src) || /^\\\\/.test(props.src)));

  useEffect(() => {
    let active = true;
    const bridge = (window as Window & { hyperframesElectron?: { loadVideoAsset?: (path: string) => Promise<string> } }).hyperframesElectron;
    setResolvedSrc(isLocalPath && bridge?.loadVideoAsset ? null : props.src);
    if (!props.src || !isLocalPath || !bridge?.loadVideoAsset) return () => { active = false; };
    void bridge.loadVideoAsset(props.src)
      .then((dataUrl) => { if (active) setResolvedSrc(dataUrl); })
      .catch((error) => console.error('video asset load failed', error));
    return () => { active = false; };
  }, [isLocalPath, props.src]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !resolvedSrc) return;

    const media = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    let target = Math.max(0, frame.localTime);
    if (media) target = props.loop ? target % media : Math.min(target, media);

    const shouldRun = isPlaying && frame.active && props.playing;

    if (shouldRun) {
      // 播放中只在明显漂移时纠偏，避免每帧 seek 造成卡顿
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
      if (v.paused) void v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.03) v.currentTime = target;
    }
  }, [frame.localTime, frame.active, isPlaying, props.loop, props.playing, resolvedSrc]);

  useEffect(() => {
    const v = ref.current;
    if (v) v.muted = props.muted;
  }, [props.muted]);

  if (!props.src || !resolvedSrc) {
    return (
      <div
        style={{ width, height }}
        className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-video/40 bg-video/5"
      >
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(192,132,252,.6)" strokeWidth="1.5">
          <rect x="2" y="4" width="14" height="16" rx="2" />
          <path d="m22 7-6 5 6 5V7Z" />
        </svg>
        <span className="text-[20px] text-white/45">{props.src ? '加载视频中…' : '在右侧上传 MP4'}</span>
      </div>
    );
  }

  return (
    <video
      ref={ref}
      src={resolvedSrc}
      muted={props.muted}
      playsInline
      preload="auto"
      style={{
        width,
        height,
        objectFit: props.objectFit,
        opacity: props.opacity * frame.opacity,
        display: 'block',
      }}
    />
  );
}
