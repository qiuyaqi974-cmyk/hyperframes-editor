import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSnapshot } from '@/types';
import { formatTime } from '@/lib/animation';
import { evaluateLayout, BlockContent } from './blockView';
import { PlaybackProvider } from './playback';

/**
 * 独立播放器：导出 HTML 与逐帧渲染共用的「画面宿主」。
 *
 * 它和编辑器使用同一套求值器（lib/animation）与同一套积木组件
 * （components/blocks，经 render/blockView 装配），因此编辑器里看到的
 * 画面与导出后渲染的画面由同一份代码保证一致。
 *
 * 对外契约（供 tools/html-to-mp4.mjs 使用）：
 *   window.__HF_SEEK(t)          —— 确定性跳帧
 *   window.__HF_PROJECT           —— 工程快照
 *   #stage                        —— 截图目标元素
 */

interface PlayerAPI {
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  getDuration: () => number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function projectDuration(project: ProjectSnapshot): number {
  const narrationEnd = project.narration?.duration ?? 0;
  const sceneEnd = project.scenes.reduce((max, s) => Math.max(max, s.end), 0);
  const blockEnd = project.blocks.reduce((max, b) => {
    const d = b.type === 'voice' ? Math.max(b.duration, (b.props as { duration?: number }).duration || 0) : b.duration;
    return Math.max(max, b.start + d);
  }, 0);
  return Math.max(6, narrationEnd, sceneEnd, blockEnd);
}

export function HyperFramesPlayer({
  project,
  onReady,
}: {
  project: ProjectSnapshot;
  onReady?: (api: PlayerAPI) => void;
}) {
  const canvas = project.canvas;
  const duration = useMemo(() => projectDuration(project), [project]);

  const [time, setTimeState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState(1);
  const timeRef = useRef(0);

  const seek = useCallback(
    (t: number) => {
      const v = clamp(Number(t) || 0, 0, duration);
      timeRef.current = v;
      setTimeState(v);
    },
    [duration],
  );

  /* 时钟：真实时间推进到 timeRef，画面完全由 time 决定 */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let t = timeRef.current + dt;
      if (t >= duration) {
        t = duration;
        setPlaying(false);
      }
      seek(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, seek]);

  /* 配音轨：跟随播放头 */
  const narrationRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    narrationRef.current?.pause();
    narrationRef.current = project.narration?.src ? new Audio(project.narration.src) : null;
    if (narrationRef.current) narrationRef.current.preload = 'auto';
    return () => narrationRef.current?.pause();
  }, [project]);

  /* 配音 + voice 积木音频：统一按播放头纠偏 */
  useEffect(() => {
    const targets: Array<{ el: HTMLMediaElement; local: number }> = [];
    if (narrationRef.current) {
      targets.push({ el: narrationRef.current, local: time });
    }
    for (const block of project.blocks) {
      if (block.type !== 'voice' || !block.props.src) continue;
      const el = document.querySelector<HTMLAudioElement>(`audio[data-voice-block="${block.id}"]`);
      if (!el) continue;
      targets.push({ el, local: Math.max(0, time - block.start) });
    }
    for (const { el, local } of targets) {
      if (Math.abs(el.currentTime - local) > (playing ? 0.3 : 0.04)) {
        try {
          el.currentTime = local;
        } catch {
          /* metadata 未就绪时下一次 tick 会继续同步 */
        }
      }
      if (playing) {
        if (el.paused) void el.play().catch(() => undefined);
      } else if (!el.paused) {
        el.pause();
      }
    }
  }, [time, playing, project.blocks]);

  /* 视口缩放 */
  useEffect(() => {
    const onResize = () =>
      setScale(Math.min(window.innerWidth / canvas.width, window.innerHeight / canvas.height));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canvas.width, canvas.height]);

  /* 对外暴露渲染契约（tools/html-to-mp4.mjs / 外部脚本使用） */
  useEffect(() => {
    const api: PlayerAPI = {
      seek,
      play: () => {
        if (timeRef.current >= duration - 0.01) seek(0);
        setPlaying(true);
      },
      pause: () => setPlaying(false),
      getDuration: () => duration,
    };
    if (typeof window !== 'undefined') {
      window.__HF_SEEK = api.seek;
      window.__HF_PROJECT = project;
      window.__HF_PLAY = api.play;
      window.__HF_PAUSE = api.pause;
      window.__HF_DURATION = duration;
    }
    onReady?.(api);
  }, [seek, duration, onReady, project]);

  const sortedBlocks = useMemo(
    () => [...project.blocks].sort((a, b) => a.layer - b.layer),
    [project.blocks],
  );

  return (
    <PlaybackProvider isPlaying={playing}>
      <div className="viewport">
        <div
          className="stage-shell"
          style={{ width: canvas.width * scale, height: canvas.height * scale }}
        >
          <div
            id="stage"
            className="stage"
            style={{
              width: canvas.width,
              height: canvas.height,
              background: canvas.background,
              transform: `scale(${scale})`,
            }}
          >
            {sortedBlocks.map((block) => {
              const layout = evaluateLayout(block, time, canvas, false);
              if (!layout.show) return null;
              return (
                <div
                  key={block.id}
                  data-block={block.id}
                  data-type={block.type}
                  data-start={block.start}
                  data-duration={block.duration}
                  style={layout.wrapStyle}
                >
                  <BlockContent
                    block={block}
                    frame={layout.frame}
                    width={layout.boxWidth}
                    height={layout.boxHeight}
                    voiceMode="view"
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="controls">
          <button
            id="play"
            type="button"
            onClick={() => {
              if (playing) {
                setPlaying(false);
              } else {
                if (timeRef.current >= duration - 0.01) seek(0);
                setPlaying(true);
              }
            }}
          >
            {playing ? '暂停' : '播放'}
          </button>
          <input
            id="seek"
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span id="time">{formatTime(time)}</span>
        </div>
      </div>
    </PlaybackProvider>
  );
}
