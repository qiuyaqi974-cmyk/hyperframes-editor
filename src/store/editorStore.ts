import { create } from 'zustand';
import type {
  AnimationSpec,
  Asset,
  Block,
  BlockType,
  CanvasConfig,
  CardProps,
  CursorProps,
  ChartProps,
  GlassUIProps,
  ImageProps,
  Position,
  ProjectSnapshot,
  NarrationTrack,
  Scene,
  ScrollStoryProps,
  SpotlightProps,
  SubtitleProps,
  TextProps,
  VideoProps,
  VoiceProps,
  ThemeId,
} from '@/types';
import {
  CANVAS_DEFAULT,
  createChartBlock,
  createCardBlock,
  createCursorBlock,
  createGlassUIBlock,
  createImageBlock,
  createScrollStoryBlock,
  createSpotlightBlock,
  createSubtitleBlock,
  createTextBlock,
  createVideoBlock,
  createVoiceBlock,
} from '@/lib/blockFactory';
import { THEMES, styleBlockForTheme } from '@/lib/themes';
import { compositionDuration } from '@/lib/animation';
import { parseSrt } from '@/lib/srt';
import { matchAssetsToScenes } from '@/lib/autoMatch';

interface EditorState {
  /* ---- 文档状态 ---- */
  canvas: CanvasConfig;
  blocks: Block[];
  assets: Asset[];
  projectName: string;
  narration: NarrationTrack | null;
  scenes: Scene[];
  themeId: ThemeId;

  /* ---- 编辑器状态 ---- */
  selectedId: string | null;
  currentTime: number;
  isPlaying: boolean;
  loopPlayback: boolean;
  /** 超出时间窗口的积木仍以幽灵态显示，方便摆位 */
  showGhosts: boolean;

  /* ---- 素材 ---- */
  addAsset: (asset: Asset) => void;
  removeAsset: (id: string) => void;
  setNarration: (track: NarrationTrack | null) => void;
  importSrt: (text: string) => number;
  autoMatchAssets: () => { matched: number; unmatchedScenes: number; unusedAssets: number };

  /* ---- 积木增删改 ---- */
  addBlock: (type: BlockType, asset?: Asset | null) => string;
  addBlockFromAsset: (asset: Asset) => string;
  duplicateBlock: (id: string) => void;
  removeBlock: (id: string) => void;
  selectBlock: (id: string | null) => void;

  updateBlock: (id: string, patch: Partial<Omit<Block, 'props' | 'animation'>>) => void;
  updateProps: (
    id: string,
    patch: Partial<
      ImageProps &
        TextProps &
        VideoProps &
        SpotlightProps &
        GlassUIProps &
        CardProps &
        CursorProps &
        ChartProps &
        ScrollStoryProps &
        SubtitleProps &
        VoiceProps
    >,
  ) => void;
  updateAnimation: (id: string, patch: Partial<AnimationSpec>) => void;
  moveBlock: (id: string, position: Position) => void;
  setTiming: (id: string, start: number, duration: number) => void;
  reorderLayer: (id: string, delta: number) => void;
  /** 按给定顺序（顶部优先 = layer 高）整体重排层级，用于图层面板拖拽排序 */
  setLayerOrder: (orderedIdsTopToBottom: string[]) => void;
  toggleVisible: (id: string) => void;
  toggleLocked: (id: string) => void;

  /* ---- 播放头 ---- */
  setTime: (t: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  toggleLoop: () => void;
  toggleGhosts: () => void;

  /* ---- 其它 ---- */
  setCanvas: (patch: Partial<CanvasConfig>) => void;
  setProjectName: (name: string) => void;
  applyTheme: (themeId: ThemeId) => void;
  clearAll: () => void;
  loadDemo: () => void;

  /* ---- 工程存取（JSON 导入 / 导出） ---- */
  exportProject: () => string;
  importProject: (json: string) => void;
  exportSnapshot: () => ProjectSnapshot;
  importSnapshot: (snapshot: ProjectSnapshot) => void;
}

const nextLayer = (blocks: Block[]) =>
  blocks.reduce((max, b) => Math.max(max, b.layer), -1) + 1;

const projectDuration = (state: Pick<EditorState, 'blocks' | 'narration' | 'scenes'>) => {
  const narrationEnd = state.narration?.duration ?? 0;
  const sceneEnd = state.scenes.reduce((max, scene) => Math.max(max, scene.end), 0);
  return Math.max(compositionDuration(state.blocks), narrationEnd, sceneEnd, 6);
};

export const useEditorStore = create<EditorState>((set, get) => ({
  canvas: { ...CANVAS_DEFAULT },
  blocks: [],
  assets: [],
  projectName: '未命名视频',
  narration: null,
  scenes: [],
  themeId: 'midnight',

  selectedId: null,
  currentTime: 0,
  isPlaying: false,
  loopPlayback: true,
  showGhosts: true,

  addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),

  removeAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),

  setNarration: (narration) => set({ narration }),

  importSrt: (text) => {
    const scenes = parseSrt(text);
    if (!scenes.length) throw new Error('没有识别到有效的 SRT 字幕');
    const { blocks, canvas } = get();
    const manualBlocks = blocks.filter((block) => block.source !== 'srt');
    let layer = nextLayer(manualBlocks);
    const generated = scenes.map((scene) => {
      const block = createSubtitleBlock(canvas, layer++, scene.start);
      block.name = `字幕 ${scene.index}`;
      block.props.text = scene.text;
      block.start = scene.start;
      block.duration = scene.duration;
      block.animation = { ...block.animation, duration: Math.min(0.22, scene.duration / 3) };
      block.source = 'srt';
      block.sceneId = scene.id;
      return block;
    });
    set({ scenes, blocks: [...manualBlocks, ...generated], selectedId: generated[0]?.id ?? null });
    return scenes.length;
  },

  addBlock: (type, asset = null) => {
    const { blocks, canvas, currentTime, themeId } = get();
    const layer = nextLayer(blocks);
    // 新积木从播放头位置入场，符合"边看边搭"的直觉
    const start = Math.round(currentTime * 10) / 10;
    let block: Block;
    if (type === 'image') block = createImageBlock(asset, canvas, layer, start);
    else if (type === 'video') block = createVideoBlock(asset, canvas, layer, start);
    else if (type === 'spotlight') block = createSpotlightBlock(canvas, layer, start);
    else if (type === 'glassui') block = createGlassUIBlock(canvas, layer, start);
    else if (type === 'card') block = createCardBlock(canvas, layer, start);
    else if (type === 'cursor') block = createCursorBlock(canvas, layer, start);
    else if (type === 'chart') block = createChartBlock(canvas, layer, start);
    else if (type === 'scrollstory') block = createScrollStoryBlock(canvas, layer, start);
    else if (type === 'subtitle') block = createSubtitleBlock(canvas, layer, start);
    else if (type === 'voice') block = createVoiceBlock(canvas, layer, start);
    else block = createTextBlock(canvas, layer, start);

    block = styleBlockForTheme(block, THEMES[themeId]);
    set({ blocks: [...blocks, block], selectedId: block.id });
    return block.id;
  },

  addBlockFromAsset: (asset) =>
    get().addBlock(asset.kind === 'video' ? 'video' : 'image', asset),

  autoMatchAssets: () => {
    const { assets, scenes, blocks, canvas } = get();
    if (!scenes.length) throw new Error('请先导入 SRT 字幕，系统才能按场景匹配素材');
    if (!assets.length) throw new Error('请先批量导入已经命名好的图片或视频');
    const result = matchAssetsToScenes(assets, scenes);
    const kept = blocks.filter((block) => block.source !== 'auto');
    let layer = nextLayer(kept);
    const generated = result.matches.map(({ asset, scene }) => {
      const block = asset.kind === 'video'
        ? createVideoBlock(asset, canvas, layer++, scene.start)
        : createImageBlock(asset, canvas, layer++, scene.start);
      block.name = `自动匹配 · ${asset.name.replace(/\.[^.]+$/, '')}`;
      block.start = scene.start;
      block.duration = scene.duration;
      block.source = 'auto';
      block.sceneId = scene.id;
      block.animation = { ...block.animation, duration: Math.min(0.35, scene.duration / 3) };
      return block;
    });
    set({ blocks: [...kept, ...generated], selectedId: generated[0]?.id ?? null, currentTime: generated[0]?.start ?? 0 });
    return { matched: generated.length, unmatchedScenes: result.unmatchedScenes.length, unusedAssets: result.unusedAssets.length };
  },

  duplicateBlock: (id) => {
    const { blocks } = get();
    const src = blocks.find((b) => b.id === id);
    if (!src) return;
    const copy: Block = {
      ...src,
      id: `${src.type}_${Math.random().toString(36).slice(2, 9)}`,
      name: `${src.name} 副本`,
      layer: nextLayer(blocks),
      position: { x: src.position.x + 40, y: src.position.y + 40 },
      props: { ...src.props } as Block['props'],
      animation: { ...src.animation },
    } as Block;
    set({ blocks: [...blocks, copy], selectedId: copy.id });
  },

  removeBlock: (id) =>
    set((s) => ({
      blocks: s.blocks.filter((b) => b.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  selectBlock: (id) => set({ selectedId: id }),

  updateBlock: (id, patch) =>
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
    })),

  updateProps: (id, patch) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === id ? ({ ...b, props: { ...b.props, ...patch } } as Block) : b,
      ),
    })),

  updateAnimation: (id, patch) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === id ? ({ ...b, animation: { ...b.animation, ...patch } } as Block) : b,
      ),
    })),

  moveBlock: (id, position) =>
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? ({ ...b, position } as Block) : b)),
    })),

  setTiming: (id, start, duration) =>
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === id
          ? ({ ...b, start: Math.max(0, start), duration: Math.max(0.1, duration) } as Block)
          : b,
      ),
    })),

  reorderLayer: (id, delta) =>
    set((s) => {
      const sorted = [...s.blocks].sort((a, b) => a.layer - b.layer);
      const i = sorted.findIndex((b) => b.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= sorted.length) return {};
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      const relayered = sorted.map((b, idx) => ({ ...b, layer: idx }) as Block);
      return { blocks: relayered };
    }),

  setLayerOrder: (ids) =>
    set((s) => {
      const map = new Map(s.blocks.map((b) => [b.id, b]));
      const ordered = ids
        .map((id) => map.get(id))
        .filter((b): b is Block => Boolean(b));
      const n = ordered.length;
      // ids 顶部优先（layer 最高），所以 index 0 → layer = n-1
      const relayered = ordered.map((b, idx) => ({ ...b, layer: n - 1 - idx }) as Block);
      return { blocks: relayered };
    }),

  toggleVisible: (id) =>
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? { ...b, visible: !b.visible } : b)),
    })),

  toggleLocked: (id) =>
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? { ...b, locked: !b.locked } : b)),
    })),

  setTime: (t) => set({ currentTime: Math.max(0, t) }),

  play: () => {
    const state = get();
    const { currentTime } = state;
    const total = projectDuration(state);
    set({ isPlaying: true, currentTime: currentTime >= total - 0.01 ? 0 : currentTime });
  },

  pause: () => set({ isPlaying: false }),

  togglePlay: () => (get().isPlaying ? get().pause() : get().play()),

  toggleLoop: () => set((s) => ({ loopPlayback: !s.loopPlayback })),

  toggleGhosts: () => set((s) => ({ showGhosts: !s.showGhosts })),

  setCanvas: (patch) => set((s) => ({ canvas: { ...s.canvas, ...patch } })),

  setProjectName: (projectName) => set({ projectName }),

  applyTheme: (themeId) => {
    const theme = THEMES[themeId];
    set((s) => ({
      themeId,
      canvas: { ...s.canvas, background: theme.background },
      blocks: s.blocks.map((block) => styleBlockForTheme(block, theme)),
    }));
  },

  clearAll: () => set({ blocks: [], selectedId: null, currentTime: 0, isPlaying: false }),

  loadDemo: () => {
    const { canvas, themeId } = get();
    const title = createTextBlock(canvas, 0, 0.2);
    title.name = '主标题';
    title.props = {
      ...title.props,
      text: '像搭积木一样\n做动效',
      fontSize: 130,
      align: 'left',
      color: '#ffffff',
    };
    title.position = { x: 180, y: 360 };
    title.animation = { ...title.animation, type: 'slide', direction: 'up', distance: 90, duration: 0.9, easing: 'easeOut' };
    title.duration = 5;

    const sub = createTextBlock(canvas, 1, 0.9);
    sub.name = '副标题';
    sub.props = {
      ...sub.props,
      text: '添加 → 调参 → 实时预览',
      fontSize: 46,
      fontWeight: 500,
      color: '#8fb4ff',
      letterSpacing: 2,
    };
    sub.position = { x: 184, y: 690 };
    sub.animation = { ...sub.animation, type: 'fade', duration: 0.8, delay: 0 };
    sub.duration = 4.3;

    const card = createCardBlock(canvas, 2, 0.5);
    card.name = '结论卡片';
    card.props.title = '一套内容，多种表达';
    card.props.body = '图表、卡片、字幕与媒体都能独立分层，并在同一时间轴里组合。';
    card.props.width = 700;
    card.props.height = 330;
    card.position = { x: 1050, y: 170 };
    card.duration = 5;

    const chart = createChartBlock(canvas, 3, 1.1);
    chart.name = '环形数据';
    chart.props.type = 'donut';
    chart.props.title = '内容组合占比';
    chart.props.data = '42,28,18,12';
    chart.props.labels = '视频,图文,数据,互动';
    chart.props.width = 700;
    chart.props.height = 430;
    chart.position = { x: 1050, y: 570 };
    chart.duration = 4.4;

    const cursor = createCursorBlock(canvas, 4, 1.4);
    cursor.position = { x: 920, y: 820 };
    cursor.props.endX = 1430;
    cursor.props.endY = 420;
    cursor.props.action = 'double-click';
    cursor.duration = 2.6;

    const theme = THEMES[themeId];
    const demo = [title, sub, card, chart, cursor].map((block) => styleBlockForTheme(block, theme));
    set({ blocks: demo, selectedId: title.id, currentTime: 0 });
  },

  exportSnapshot: () => {
    const { projectName, canvas, blocks, assets, narration, scenes, themeId } = get();
    return {
      app: 'hyperframes-editor',
      version: 4,
      themeId,
      projectName,
      canvas,
      blocks,
      assets,
      narration,
      scenes,
      updatedAt: new Date().toISOString(),
    };
  },

  exportProject: () => JSON.stringify(get().exportSnapshot(), null, 2),

  importSnapshot: (snap) => {
    if (!snap || snap.app !== 'hyperframes-editor') {
      throw new Error('不是 HyperFrames 编辑器导出的工程文件');
    }
    set({
      projectName: snap.projectName || '未命名视频',
      canvas: snap.canvas ?? get().canvas,
      blocks: Array.isArray(snap.blocks) ? snap.blocks : [],
      assets: Array.isArray(snap.assets) ? snap.assets : [],
      narration: snap.narration ?? null,
      scenes: Array.isArray(snap.scenes) ? snap.scenes : [],
      themeId: snap.themeId && THEMES[snap.themeId] ? snap.themeId : 'midnight',
      selectedId: null,
      currentTime: 0,
      isPlaying: false,
    });
  },

  importProject: (json) => {
    let snap: ProjectSnapshot;
    try {
      snap = JSON.parse(json);
    } catch {
      throw new Error('工程文件不是合法的 JSON');
    }
    get().importSnapshot(snap);
  },
}));

/* ---------- selectors ---------- */

export const useSelectedBlock = (): Block | null => {
  const id = useEditorStore((s) => s.selectedId);
  const blocks = useEditorStore((s) => s.blocks);
  return blocks.find((b) => b.id === id) ?? null;
};

export const useDuration = (): number => {
  return useEditorStore((s) => projectDuration(s));
};
