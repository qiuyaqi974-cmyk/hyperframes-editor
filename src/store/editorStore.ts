import { create } from 'zustand';
import type {
  AnimationSpec,
  Asset,
  Block,
  BlockPropsPatch,
  BlockType,
  CanvasConfig,
  DirectorDecision,
  DirectorSceneDecision,
  ExternalMediaSource,
  ExternalClipInbox,
  ProjectSnapshot,
  NarrationTrack,
  Scene,
  SceneReview,
  SceneReviewStatus,
  SourceStoryAssembly,
  SourceStoryAssemblyVersion,
  SourceStoryVersionSelection,
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
import { parseSrt } from '@/lib/srt';
import { matchAssetsToScenes } from '@/lib/autoMatch';
import { synthesizeScript, type VoiceoverOptions } from '@/lib/pipeline/voiceover';
import { useUIStore } from './uiStore';
import { projectDuration } from './projectDuration';
import { EMPTY_DIRECTOR_DECISION, lockedSceneIds, normalizeDirectorDecision } from '@/lib/directorDecision';
import { emptySceneReview, normalizeSceneReviews } from '@/lib/sceneReview';
import { installEditorHistory, invalidateHistoryApprovals, resetEditorHistory } from './editorHistory';

/**
 * 文档 store：只保存「工程是什么」——可序列化、可导出的内容。
 *
 * 播放头、选择、播放状态等编辑器 UI 状态在 uiStore。
 * 两者分离后，自动保存 / JSON 导出只订阅本 store，
 * 不会被播放头每帧更新搅动。
 */
interface EditorDocumentState {
  canvas: CanvasConfig;
  blocks: Block[];
  assets: Asset[];
  sourceMedia: ExternalMediaSource[];
  storyAssembly?: SourceStoryAssembly;
  storyAssemblyVersions: SourceStoryAssemblyVersion[];
  externalClipInboxes: ExternalClipInbox[];
  setExternalClipInboxes: (inboxes: ExternalClipInbox[]) => void;
  storyVersionSelection?: SourceStoryVersionSelection;
  projectName: string;
  narration: NarrationTrack | null;
  scenes: Scene[];
  reviews: Record<string, SceneReview>;
  themeId: ThemeId;
  director: DirectorDecision;
  /** 最近一次批量配音前的工程快照，只用于一次性撤销，不参与导出。 */
  voiceTimelineUndo: ProjectSnapshot | null;

  /* ---- 素材 ---- */
  addAsset: (asset: Asset) => void;
  removeAsset: (id: string) => void;
  addSourceMedia: (source: ExternalMediaSource) => void;
  updateSourceMedia: (id: string, patch: Partial<ExternalMediaSource>) => void;
  setStoryAssembly: (assembly: SourceStoryAssembly | undefined) => void;
  setStoryAssemblyVersions: (versions: SourceStoryAssemblyVersion[]) => void;
  setStoryVersionSelection: (selection: SourceStoryVersionSelection | undefined) => void;
  removeSourceMedia: (id: string) => void;
  addSourceClip: (sourceId: string, sourceIn: number, sourceOut: number) => string;
  bindAssetToSelectedImage: (asset: Asset) => boolean;
  setNarration: (track: NarrationTrack | null) => void;
  importSrt: (text: string) => number;
  /** 口播生产线：整篇口播稿 → 逐句 TTS → 配音块 + 字幕 + 场景轨（替换旧 pipeline/srt 内容） */
  importVoiceoverScript: (script: string, options?: VoiceoverOptions) => Promise<number>;
  autoMatchAssets: () => { matched: number; unmatchedScenes: number; unusedAssets: number; lockedScenes: number };

  /* ---- 导演决策 ---- */
  updateDirector: (patch: Partial<Omit<DirectorDecision, 'scenes' | 'updatedAt'>>) => void;
  updateSceneDecision: (sceneId: string, patch: Partial<Omit<DirectorSceneDecision, 'sceneId'>>) => void;
  setSceneReviewStatus: (sceneId: string, status: SceneReviewStatus) => void;
  addSceneReviewComment: (sceneId: string, time: number, text: string) => string;
  resolveSceneReviewComment: (sceneId: string, commentId: string, resolved: boolean) => void;
  importGeneratedSnapshot: (snapshot: ProjectSnapshot) => void;
  applyVoiceTimeline: (snapshot: ProjectSnapshot, previous: ProjectSnapshot) => void;
  undoVoiceTimeline: () => boolean;

  /* ---- 积木增删改 ---- */
  addBlock: (type: BlockType, asset?: Asset | null) => string;
  addBlockFromAsset: (asset: Asset) => string;
  duplicateBlock: (id: string) => void;
  removeBlock: (id: string) => void;

  updateBlock: (id: string, patch: Partial<Omit<Block, 'props' | 'animation'>>) => void;
  /** 类型安全 + 运行时字段过滤的 props 局部更新 */
  updateProps: (id: string, patch: BlockPropsPatch) => void;
  updateAnimation: (id: string, patch: Partial<AnimationSpec>) => void;
  moveBlock: (id: string, position: { x: number; y: number }) => void;
  setTiming: (id: string, start: number, duration: number) => void;
  reorderLayer: (id: string, delta: number) => void;
  /** 按给定顺序（顶部优先 = layer 高）整体重排层级，用于图层面板拖拽排序 */
  setLayerOrder: (orderedIdsTopToBottom: string[]) => void;
  toggleVisible: (id: string) => void;
  toggleLocked: (id: string) => void;

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
  importSnapshot: (snapshot: ProjectSnapshot, preserveHistory?: boolean) => void;
}

const nextLayer = (blocks: Block[]) =>
  blocks.reduce((max, b) => Math.max(max, b.layer), -1) + 1;

export const useEditorStore = create<EditorDocumentState>((set, get) => ({
  canvas: { ...CANVAS_DEFAULT },
  blocks: [],
  assets: [],
  sourceMedia: [],
  storyAssembly: undefined,
  storyAssemblyVersions: [],
  externalClipInboxes: [],
  setExternalClipInboxes: (externalClipInboxes) => set({ externalClipInboxes }),
  storyVersionSelection: undefined,
  projectName: '未命名视频',
  narration: null,
  scenes: [],
  reviews: {},
  themeId: 'midnight',
  director: { ...EMPTY_DIRECTOR_DECISION, scenes: {} },
  voiceTimelineUndo: null,

  addSourceMedia: (source) => set((state) => ({
    sourceMedia: state.sourceMedia.some((item) => item.id === source.id)
      ? state.sourceMedia.map((item) => item.id === source.id ? source : item)
      : [...state.sourceMedia, source],
  })),
  updateSourceMedia: (id, patch) => set((state) => ({
    sourceMedia: state.sourceMedia.map((item) => item.id === id ? { ...item, ...patch } : item),
  })),
  setStoryAssembly: (storyAssembly) => set({ storyAssembly }),
  setStoryAssemblyVersions: (storyAssemblyVersions) => set({ storyAssemblyVersions }),
  setStoryVersionSelection: (storyVersionSelection) => set({ storyVersionSelection }),
  removeSourceMedia: (id) => set((state) => ({
    sourceMedia: state.sourceMedia.filter((item) => item.id !== id),
    blocks: state.blocks.filter((block) => block.type !== 'video' || block.props.externalSourceId !== id),
  })),
  addSourceClip: (sourceId, rawIn, rawOut) => {
    const source = get().sourceMedia.find((item) => item.id === sourceId);
    if (!source) throw new Error('找不到这条源素材。');
    const sourceIn = Math.max(0, Math.min(rawIn, source.duration));
    const sourceOut = Math.max(sourceIn + 0.1, Math.min(rawOut, source.duration));
    const id = get().addBlock('video');
    const block = get().blocks.find((item) => item.id === id);
    if (!block || block.type !== 'video') return id;
    const width = source.width || 1280;
    const height = source.height || 720;
    const scale = Math.min(1, (get().canvas.width * 0.8) / width, (get().canvas.height * 0.8) / height);
    set((state) => ({ blocks: state.blocks.map((item) => item.id === id && item.type === 'video' ? {
      ...item,
      name: `${source.name.replace(/\.[^.]+$/, '')} ${sourceIn.toFixed(1)}-${sourceOut.toFixed(1)}s`,
      duration: Number((sourceOut - sourceIn).toFixed(3)),
      position: {
        x: Math.round((state.canvas.width - width * scale) / 2),
        y: Math.round((state.canvas.height - height * scale) / 2),
      },
      props: {
        ...item.props,
        assetId: null,
        externalSourceId: source.id,
        src: source.path,
        sourceIn,
        sourceOut,
        width,
        height,
        scale,
        loop: false,
        muted: false,
      },
      animation: { ...item.animation, type: 'none', duration: 0 },
    } : item) }));
    return id;
  },

  updateDirector: (patch) => set((state) => ({
    director: { ...state.director, ...patch, updatedAt: new Date().toISOString() },
  })),

  updateSceneDecision: (sceneId, patch) => set((state) => ({
    director: {
      ...state.director,
      scenes: {
        ...state.director.scenes,
        [sceneId]: {
          ...(state.director.scenes[sceneId] ?? {
            sceneId,
            narrativeRole: 'custom' as const,
            intent: '',
            visualRule: '',
            locked: false,
          }),
          ...patch,
        },
      },
      updatedAt: new Date().toISOString(),
    },
  })),

  setSceneReviewStatus: (sceneId, status) => set((state) => {
    const now = new Date().toISOString();
    const current = state.reviews[sceneId] ?? emptySceneReview(sceneId);
    const existingDecision = state.director.scenes[sceneId] ?? {
      sceneId,
      narrativeRole: 'custom' as const,
      intent: '',
      visualRule: '',
      locked: false,
    };
    const shouldUpdateLock = status === 'approved' || status === 'changes' || status === 'redo';
    return {
      reviews: { ...state.reviews, [sceneId]: { ...current, status, updatedAt: now } },
      director: shouldUpdateLock ? {
        ...state.director,
        scenes: { ...state.director.scenes, [sceneId]: { ...existingDecision, locked: status === 'approved' } },
        updatedAt: now,
      } : state.director,
    };
  }),

  addSceneReviewComment: (sceneId, rawTime, rawText) => {
    const text = rawText.trim();
    if (!text) throw new Error('批注内容不能为空。');
    const scene = get().scenes.find((item) => item.id === sceneId);
    if (!scene) throw new Error('找不到这个场景。');
    const time = Math.max(scene.start, Math.min(rawTime, scene.end));
    const id = `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    set((state) => {
      const current = state.reviews[sceneId] ?? emptySceneReview(sceneId);
      const existingDecision = state.director.scenes[sceneId];
      return {
        reviews: {
          ...state.reviews,
          [sceneId]: {
            ...current,
            status: current.status === 'approved' ? 'changes' : current.status,
            comments: [...current.comments, { id, time, text, resolved: false, createdAt: now }],
            updatedAt: now,
          },
        },
        director: current.status === 'approved' && existingDecision ? {
          ...state.director,
          scenes: { ...state.director.scenes, [sceneId]: { ...existingDecision, locked: false } },
          updatedAt: now,
        } : state.director,
      };
    });
    return id;
  },

  resolveSceneReviewComment: (sceneId, commentId, resolved) => set((state) => {
    const current = state.reviews[sceneId];
    if (!current) return state;
    return {
      reviews: {
        ...state.reviews,
        [sceneId]: {
          ...current,
          comments: current.comments.map((comment) => comment.id === commentId ? { ...comment, resolved } : comment),
          updatedAt: new Date().toISOString(),
        },
      },
    };
  }),

  addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),

  removeAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),

  bindAssetToSelectedImage: (asset) => {
    const selectedId = useUIStore.getState().selectedId;
    const { blocks } = get();
    const selected = blocks.find((block) => block.id === selectedId);
    if (!selected || selected.type !== 'image' || asset.kind !== 'image') return false;
    set((s) => ({
      blocks: s.blocks.map((block) => block.id === selected.id
        ? ({
          ...block,
          name: asset.name.replace(/\.[^.]+$/, ''),
          props: { ...block.props, assetId: asset.id, src: asset.url },
        } as Block)
        : block),
    }));
    return true;
  },

  setNarration: (narration) => set({ narration }),

  importSrt: (text) => {
    const locked = lockedSceneIds(get().director, get().scenes);
    if (locked.length) throw new Error(`有 ${locked.length} 个导演锁定场景；请先解锁再重建字幕结构。`);
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
    set((state) => ({
      scenes,
      blocks: [...manualBlocks, ...generated],
      reviews: Object.fromEntries(Object.entries(state.reviews).filter(([sceneId]) => scenes.some((scene) => scene.id === sceneId))),
    }));
    useUIStore.getState().selectBlock(generated[0]?.id ?? null);
    return scenes.length;
  },

  importVoiceoverScript: async (script, options) => {
    const locked = lockedSceneIds(get().director, get().scenes);
    if (locked.length) throw new Error(`有 ${locked.length} 个导演锁定场景；请先解锁再重建配音时间轴。`);
    const { canvas } = get();
    const generated = await synthesizeScript(script, canvas, options);
    // 与 importSrt 同一替换语义：口播轨道（pipeline 配音块 + srt 字幕）整体重建
    const kept = get().blocks.filter(
      (block) => block.source !== 'pipeline' && block.source !== 'srt',
    );
    set((state) => ({
      scenes: generated.scenes,
      blocks: [...kept, ...generated.blocks],
      reviews: Object.fromEntries(Object.entries(state.reviews).filter(([sceneId]) => generated.scenes.some((scene) => scene.id === sceneId))),
    }));
    const ui = useUIStore.getState();
    ui.selectBlock(generated.blocks[0]?.id ?? null);
    ui.setTime(0);
    return generated.scenes.length;
  },

  addBlock: (type, asset = null) => {
    const { blocks, canvas, themeId } = get();
    const layer = nextLayer(blocks);
    // 新积木从播放头位置入场，符合"边看边搭"的直觉
    const start = Math.round(useUIStore.getState().currentTime * 10) / 10;
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
    set({ blocks: [...blocks, block] });
    useUIStore.getState().selectBlock(block.id);
    return block.id;
  },

  addBlockFromAsset: (asset) =>
    get().addBlock(asset.kind === 'video' ? 'video' : 'image', asset),

  autoMatchAssets: () => {
    const { assets, scenes, blocks, canvas, director } = get();
    if (!scenes.length) throw new Error('请先导入 SRT 字幕，系统才能按场景匹配素材');
    if (!assets.length) throw new Error('请先批量导入已经命名好的图片或视频');
    const lockedIds = new Set(lockedSceneIds(director, scenes));
    const editableScenes = scenes.filter((scene) => !lockedIds.has(scene.id));
    const lockedAssetIds = new Set(
      blocks
        .flatMap((block) => block.sceneId && lockedIds.has(block.sceneId) && (block.type === 'image' || block.type === 'video')
          ? [block.props.assetId]
          : [])
        .filter((id): id is string => Boolean(id)),
    );
    const editableAssets = assets.filter((asset) => !lockedAssetIds.has(asset.id));
    const result = matchAssetsToScenes(editableAssets, editableScenes);
    const kept = blocks.filter((block) => block.source !== 'auto' || Boolean(block.sceneId && lockedIds.has(block.sceneId)));
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
    set({ blocks: [...kept, ...generated] });
    const ui = useUIStore.getState();
    ui.selectBlock(generated[0]?.id ?? null);
    ui.setTime(generated[0]?.start ?? 0);
    return { matched: generated.length, unmatchedScenes: result.unmatchedScenes.length, unusedAssets: result.unusedAssets.length, lockedScenes: lockedIds.size };
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
    set({ blocks: [...blocks, copy] });
    useUIStore.getState().selectBlock(copy.id);
  },

  removeBlock: (id) => {
    set((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) }));
    if (useUIStore.getState().selectedId === id) {
      useUIStore.getState().selectBlock(null);
    }
  },

  updateBlock: (id, patch) =>
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
    })),

  updateProps: (id, patch) =>
    set((s) => ({
      blocks: s.blocks.map((b) => {
        if (b.id !== id) return b;
        // 运行时防线：只接受目标积木自身 props 里存在的字段，
        // 防止跨类型补丁把脏字段写进文档（如给 text 积木写 paddingX）。
        const known = new Set(Object.keys(b.props));
        const entries = Object.entries(patch).filter(([key]) => known.has(key));
        const dropped = Object.keys(patch).filter((key) => !known.has(key));
        if (dropped.length) {
          console.warn(`updateProps: 忽略不属于 ${b.type} 积木的字段 — ${dropped.join(', ')}`);
        }
        if (!entries.length) return b;
        return { ...b, props: { ...b.props, ...Object.fromEntries(entries) } } as Block;
      }),
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

  clearAll: () => {
    set({ blocks: [] });
    const ui = useUIStore.getState();
    ui.selectBlock(null);
    ui.setTime(0);
    ui.pause();
  },

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
    set({ blocks: demo });
    const ui = useUIStore.getState();
    ui.selectBlock(title.id);
    ui.setTime(0);
  },

  exportSnapshot: () => {
    const { projectName, canvas, blocks, assets, sourceMedia, storyAssembly, storyAssemblyVersions, storyVersionSelection, narration, scenes, reviews, themeId, director } = get();
    return {
      app: 'hyperframes-editor',
      version: 4,
      themeId,
      projectName,
      canvas,
      blocks,
      assets,
      sourceMedia,
      storyAssembly,
      storyAssemblyVersions,
      externalClipInboxes: get().externalClipInboxes,
      storyVersionSelection,
      narration,
      scenes,
      reviews,
      director,
      updatedAt: new Date().toISOString(),
    };
  },

  exportProject: () => JSON.stringify(get().exportSnapshot(), null, 2),

  importSnapshot: (snap, preserveHistory = false) => {
    if (!snap || snap.app !== 'hyperframes-editor') {
      throw new Error('不是 HyperFrames 编辑器导出的工程文件');
    }
    if (!preserveHistory) resetEditorHistory();
    set({
      projectName: snap.projectName || '未命名视频',
      canvas: snap.canvas ?? get().canvas,
      blocks: Array.isArray(snap.blocks)
        ? snap.blocks.map((block) =>
            {
              if (block.type !== 'voice') return block;
              const legacyDefault = block.props.voiceName === 'x6_lingyuyan_pro'
                && block.props.speed === 60
                && block.props.volume === 50
                && block.props.ttsCacheKey === undefined;
              return {
                ...block,
                props: {
                  ...block.props,
                  voiceName: legacyDefault ? 'x4_lingyuyan' : block.props.voiceName || 'x4_lingyuyan',
                  speed: legacyDefault ? 68 : block.props.speed ?? 68,
                  volume: legacyDefault ? 56 : block.props.volume ?? 56,
                  pitch: block.props.pitch ?? 48,
                  generated: block.props.generated ?? Boolean(block.props.src),
                  ttsCacheKey: block.props.ttsCacheKey,
                },
              } as Block;
            },
          )
        : [],
      assets: Array.isArray(snap.assets) ? snap.assets : [],
      sourceMedia: Array.isArray(snap.sourceMedia) ? snap.sourceMedia : [],
      storyAssembly: snap.storyAssembly,
      storyAssemblyVersions: Array.isArray(snap.storyAssemblyVersions) ? snap.storyAssemblyVersions : [],
      externalClipInboxes: Array.isArray(snap.externalClipInboxes) ? snap.externalClipInboxes : [],
      storyVersionSelection: snap.storyVersionSelection,
      narration: snap.narration ?? null,
      scenes: Array.isArray(snap.scenes) ? snap.scenes : [],
      reviews: normalizeSceneReviews(snap.reviews),
      director: normalizeDirectorDecision(snap.director),
      voiceTimelineUndo: null,
      themeId: snap.themeId && THEMES[snap.themeId] ? snap.themeId : 'midnight',
    });
    const ui = useUIStore.getState();
    ui.selectBlock(null);
    ui.setTime(0);
    ui.pause();
    if (!preserveHistory) resetEditorHistory();
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

  importGeneratedSnapshot: (snapshot) => {
    const { director, scenes, reviews } = get();
    const locked = lockedSceneIds(director, scenes);
    if (locked.length) throw new Error(`有 ${locked.length} 个导演锁定场景；自动生成不能覆盖它们，请先解锁或新建工程。`);
    const nextIds = new Set(snapshot.scenes.map((scene) => scene.id));
    get().importSnapshot({
      ...snapshot,
      director,
      reviews: Object.fromEntries(Object.entries(reviews).filter(([sceneId]) => nextIds.has(sceneId))),
    }, true);
  },

  applyVoiceTimeline: (snapshot, previous) => {
    get().importSnapshot(snapshot, true);
    set({ voiceTimelineUndo: previous });
  },

  undoVoiceTimeline: () => {
    const previous = get().voiceTimelineUndo;
    if (!previous) return false;
    get().importSnapshot({ ...previous, ...invalidateHistoryApprovals(previous) }, true);
    set({ voiceTimelineUndo: null });
    return true;
  },
}));

export const editorHistory = installEditorHistory(useEditorStore);

/* ---------- 跨 store 选择器 ---------- */

export const useSelectedBlock = (): Block | null => {
  const id = useUIStore((s) => s.selectedId);
  const blocks = useEditorStore((s) => s.blocks);
  return blocks.find((b) => b.id === id) ?? null;
};

export const useDuration = (): number => {
  return useEditorStore((s) => projectDuration(s));
};
