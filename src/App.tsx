import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';
import { projectDuration } from '@/store/projectDuration';
import BlockLibrary from '@/components/sidebar/BlockLibrary';
import EditorCanvas from '@/components/canvas/EditorCanvas';
import PropertyPanel from '@/components/inspector/PropertyPanel';
import Timeline from '@/components/timeline/Timeline';
import { fileToNarration } from '@/lib/assets';
import { generateHyperFramesHtml } from '@/lib/exportHtml';
import { loadAutosave, saveAutosave } from '@/lib/persistence';
import { THEME_LIST } from '@/lib/themes';
import { PlaybackProvider } from '@/render/playback';
import type { ProjectSnapshot, ThemeId } from '@/types';
import AgentMenu from '@/components/agent/AgentMenu';

/**
 * 播放引擎。
 *
 * 只做一件事：把真实时间推进到 uiStore 的 currentTime。
 * 画面怎么长由求值器决定——播放和渲染彻底解耦，
 * 所以「播放」和「手动拖播放头」走的是完全相同的渲染路径。
 */
function usePlaybackEngine() {
  const isPlaying = useUIStore((s) => s.isPlaying);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      const ui = useUIStore.getState();
      const doc = useEditorStore.getState();
      const total = projectDuration(doc);
      let t = ui.currentTime + dt;

      if (t >= total) {
        if (ui.loopPlayback) {
          t = total > 0 ? t % total : 0;
        } else {
          ui.pause();
          t = total;
        }
      }
      ui.setTime(t);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);
}

function useNarrationEngine() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const narration = useEditorStore((s) => s.narration);

  useEffect(() => {
    audio.current?.pause();
    audio.current = narration ? new Audio(narration.src) : null;
    if (audio.current) audio.current.preload = 'auto';
    return () => audio.current?.pause();
  }, [narration]);

  useEffect(() => {
    return useUIStore.subscribe((state) => {
      const el = audio.current;
      if (!el) return;
      if (Math.abs(el.currentTime - state.currentTime) > (state.isPlaying ? 0.3 : 0.04)) {
        try {
          el.currentTime = state.currentTime;
        } catch {
          // metadata 尚未就绪时，下一次状态变化会继续同步
        }
      }
      if (state.isPlaying) {
        if (el.paused) void el.play().catch(() => undefined);
      } else if (!el.paused) {
        el.pause();
      }
    });
  }, []);
}

/** 让已生成的 VoiceBlock 跟随编辑器播放头，不让音频自行脱离时间轴播放。 */
function useVoiceAudioEngine() {
  useEffect(() => {
    return useUIStore.subscribe((ui) => {
      const { blocks } = useEditorStore.getState();
      for (const block of blocks) {
        if (block.type !== 'voice' || !block.props.src) continue;
        const audio = document.querySelector<HTMLAudioElement>(
          `audio[data-voice-block="${block.id}"]`,
        );
        if (!audio) continue;
        const duration = Math.max(block.duration, block.props.duration || 0);
        const active = ui.currentTime >= block.start && ui.currentTime <= block.start + duration;
        const localTime = Math.max(0, ui.currentTime - block.start);
        if (Math.abs(audio.currentTime - localTime) > (ui.isPlaying ? 0.3 : 0.04)) {
          try {
            audio.currentTime = localTime;
          } catch {
            // 元数据尚未就绪时，下一次播放头变化会继续同步。
          }
        }
        if (ui.isPlaying && active) {
          if (audio.paused) void audio.play().catch(() => undefined);
        } else if (!audio.paused) {
          audio.pause();
        }
      }
    });
  }, []);
}

function useAutosave() {
  const [status, setStatus] = useState('正在恢复…');

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let unsubscribe: () => void = () => {};

    void loadAutosave()
      .then((snapshot) => {
        if (disposed) return;
        if (snapshot && useEditorStore.getState().blocks.length === 0) {
          useEditorStore.getState().importSnapshot(snapshot);
        }
        setStatus(snapshot ? '已恢复并自动保存' : '自动保存已开启');
        // 只订阅文档 store：播放头每帧变化不会触发保存防抖
        unsubscribe = useEditorStore.subscribe(() => {
          window.clearTimeout(timer);
          setStatus('保存中…');
          timer = window.setTimeout(() => {
            void saveAutosave(useEditorStore.getState().exportSnapshot())
              .then(() => setStatus('已自动保存'))
              .catch(() => setStatus('自动保存失败'));
          }, 650);
        });
      })
      .catch(() => setStatus('自动恢复不可用'));

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return status;
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable;
      if (typing) return;

      const ui = useUIStore.getState();
      const doc = useEditorStore.getState();

      if (e.code === 'Space') {
        e.preventDefault();
        ui.togglePlay();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedId) {
        e.preventDefault();
        doc.removeBlock(ui.selectedId);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && ui.selectedId) {
        e.preventDefault();
        doc.duplicateBlock(ui.selectedId);
      }
      if (e.key === 'Escape') ui.selectBlock(null);
      if (e.key === 'ArrowLeft') ui.setTime(Math.max(0, ui.currentTime - (e.shiftKey ? 1 : 1 / 30)));
      if (e.key === 'ArrowRight') ui.setTime(ui.currentTime + (e.shiftKey ? 1 : 1 / 30));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** 画布需要知道播放状态（VideoBlock 等媒体积木由该上下文驱动）。 */
function CanvasWithPlayback() {
  const isPlaying = useUIStore((s) => s.isPlaying);
  return (
    <PlaybackProvider isPlaying={isPlaying}>
      <EditorCanvas />
    </PlaybackProvider>
  );
}

export default function App() {
  usePlaybackEngine();
  useShortcuts();
  useNarrationEngine();
  useVoiceAudioEngine();
  const autosaveStatus = useAutosave();

  const blocks = useEditorStore((s) => s.blocks);
  const loadDemo = useEditorStore((s) => s.loadDemo);
  const clearAll = useEditorStore((s) => s.clearAll);
  const exportProject = useEditorStore((s) => s.exportProject);
  const importProject = useEditorStore((s) => s.importProject);
  const importSrt = useEditorStore((s) => s.importSrt);
  const setNarration = useEditorStore((s) => s.setNarration);
  const projectName = useEditorStore((s) => s.projectName);
  const setProjectName = useEditorStore((s) => s.setProjectName);
  const themeId = useEditorStore((s) => s.themeId);
  const applyTheme = useEditorStore((s) => s.applyTheme);
  const narration = useEditorStore((s) => s.narration);
  const fileRef = useRef<HTMLInputElement>(null);
  const srtRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onImportSnapshot = (event: Event) => {
      const snapshot = (event as CustomEvent<ProjectSnapshot>).detail;
      if (snapshot) useEditorStore.getState().importSnapshot(snapshot);
    };
    window.addEventListener('hyperframes:import-snapshot', onImportSnapshot);
    return () => window.removeEventListener('hyperframes:import-snapshot', onImportSnapshot);
  }, []);

  const handleExport = () => {
    const json = exportProject();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hyperframes-composition-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const download = (content: string, type: string, filename: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSrtFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const count = importSrt(await file.text());
      alert(`已生成 ${count} 个场景，并自动建立字幕时间轴。`);
    } catch (err) {
      alert(`SRT 导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setNarration(await fileToNarration(file));
    } catch (err) {
      alert(`配音导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleHtmlExport = () => {
    const state = useEditorStore.getState();
    download(
      generateHyperFramesHtml(state.exportSnapshot()),
      'text/html;charset=utf-8',
      `${state.projectName || 'hyperframes-video'}.html`,
    );
  };

  const handleMp4Export = () => {
    const state = useEditorStore.getState();
    download(generateHyperFramesHtml(state.exportSnapshot()), 'text/html;charset=utf-8', `${state.projectName || 'hyperframes-video'}.render.html`);
    alert('渲染文件已下载。把它拖到项目文件夹里的“HTML转MP4.bat”上，就会自动生成 MP4。');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      importProject(text);
    } catch (err) {
      alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0e1014] font-ui text-ink">
      {/* 顶栏 */}
      <header className="flex h-11 shrink-0 items-center gap-3 overflow-x-auto border-b border-stroke bg-panel px-4">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded bg-accent text-[11px] font-bold text-white">
            H
          </span>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-[170px] truncate bg-transparent text-[13px] font-semibold tracking-tight text-ink outline-none"
            aria-label="工程名称"
          />
          <span className="rounded bg-panel-3 px-1.5 py-[1px] font-mono text-[9.5px] text-ink-faint">
            V4.0.1
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-md border border-stroke bg-panel-3 px-2 py-[3px] text-[10.5px] text-ink-faint">
            主题
            <select
              value={themeId}
              onChange={(e) => applyTheme(e.target.value as ThemeId)}
              className="bg-transparent py-[2px] text-[11px] text-ink outline-none"
              aria-label="HTML 主题"
            >
              {THEME_LIST.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
            </select>
          </label>
          <span className="hidden text-[10.5px] text-ink-faint xl:inline">
            {narration ? `配音：${narration.name}` : autosaveStatus}
          </span>
          <button
            onClick={() => audioRef.current?.click()}
            className="rounded-md border border-stroke bg-panel-3 px-2.5 py-[5px] text-[11px] text-ink-dim hover:border-accent hover:text-ink"
          >
            导入配音
          </button>
          <input ref={audioRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioFile} />
          <button
            onClick={() => srtRef.current?.click()}
            className="rounded-md border border-stroke bg-panel-3 px-2.5 py-[5px] text-[11px] text-ink-dim hover:border-accent hover:text-ink"
          >
            导入 SRT
          </button>
          <input ref={srtRef} type="file" accept=".srt,text/plain" className="hidden" onChange={handleSrtFile} />
          <button
            onClick={handleHtmlExport}
            className="rounded-md bg-accent px-2.5 py-[5px] text-[11px] font-medium text-white hover:brightness-110"
          >
            导出 HTML
          </button>
          <AgentMenu />
          <button
            onClick={handleMp4Export}
            className="rounded-md bg-emerald-500 px-2.5 py-[5px] text-[11px] font-medium text-white hover:brightness-110"
          >
            导出 MP4
          </button>
          <button
            onClick={handleExport}
            className="rounded-md border border-stroke bg-panel-3 px-2.5 py-[5px] text-[11px] text-ink-dim hover:border-accent hover:text-ink"
          >
            导出 JSON
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-stroke bg-panel-3 px-2.5 py-[5px] text-[11px] text-ink-dim hover:border-accent hover:text-ink"
          >
            导入 JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={loadDemo}
            className="rounded-md border border-stroke bg-panel-3 px-2.5 py-[5px] text-[11px] text-ink-dim hover:border-accent hover:text-ink"
          >
            载入示例
          </button>
          <button
            onClick={clearAll}
            className="rounded-md border border-stroke bg-panel-3 px-2.5 py-[5px] text-[11px] text-ink-dim hover:border-red-400/60 hover:text-red-300"
          >
            清空
          </button>
        </div>
      </header>

      {/* 三栏 */}
      <div className="flex min-h-0 flex-1">
        <BlockLibrary />
        <motion.main
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="flex min-w-0 flex-1 flex-col"
        >
          <CanvasWithPlayback />
        </motion.main>
        <PropertyPanel />
      </div>

      {/* 时间轴 */}
      <Timeline />

      {/* 首次进入的引导 */}
      <AnimatePresence>
        {blocks.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-none fixed bottom-[268px] left-1/2 -translate-x-1/2 rounded-full border border-stroke bg-panel-2/95 px-4 py-2 text-[11.5px] text-ink-dim shadow-lg backdrop-blur"
          >
            闭环体验：左侧点一个积木 → 画布出现 → 右侧改参数 → 底部拖时间轴看动画
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
