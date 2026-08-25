import { create } from 'zustand';
import { useEditorStore } from './editorStore';
import { projectDuration } from './projectDuration';

/**
 * 编辑器 UI / 播放状态。
 *
 * 与文档状态（editorStore）刻意分开：
 * - 播放头每帧变化、选择随点击变化，都不再触碰文档订阅者
 *   （自动保存、JSON 导出等只依赖 editorStore，不会被播放搅动）；
 * - UI 状态不参与工程序列化，导出/导入只走 editorStore。
 */

interface EditorUIState {
  /** 当前选中的积木 */
  selectedId: string | null;
  /** 播放头（秒） */
  currentTime: number;
  isPlaying: boolean;
  loopPlayback: boolean;
  /** 超出时间窗口的积木仍以幽灵态显示，方便摆位 */
  showGhosts: boolean;

  selectBlock: (id: string | null) => void;
  setTime: (t: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  toggleLoop: () => void;
  toggleGhosts: () => void;
}

export const useUIStore = create<EditorUIState>((set, get) => ({
  selectedId: null,
  currentTime: 0,
  isPlaying: false,
  loopPlayback: true,
  showGhosts: true,

  selectBlock: (id) => set({ selectedId: id }),

  setTime: (t) => set({ currentTime: Math.max(0, t) }),

  play: () => {
    const { currentTime } = get();
    const total = projectDuration(useEditorStore.getState());
    set({ isPlaying: true, currentTime: currentTime >= total - 0.01 ? 0 : currentTime });
  },

  pause: () => set({ isPlaying: false }),

  togglePlay: () => (get().isPlaying ? get().pause() : get().play()),

  toggleLoop: () => set((s) => ({ loopPlayback: !s.loopPlayback })),

  toggleGhosts: () => set((s) => ({ showGhosts: !s.showGhosts })),
}));
