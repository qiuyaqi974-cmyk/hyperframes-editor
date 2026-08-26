import type { LayoutPreset } from '@/lib/layout/layoutPreset';

/**
 * HyperFrames 积木编辑器 —— 核心数据模型
 *
 * 设计约束来自 HyperFrames 的渲染契约：
 *  1. 一个合成 = 一棵 DOM 树，时序由 data-* 属性声明；
 *  2. 动画运行时必须「可 seek」——任意时间点 t 都能确定性地求出画面；
 *  3. 媒体（video）的播放由框架托管，而不是元素自己播。
 *
 * 因此这里的 Block 不存"当前状态"，只存**时序声明**。
 * 画面 = pure_function(blocks, t)。见 lib/animation.ts。
 */

export type BlockType =
  | 'image'
  | 'text'
  | 'video'
  | 'spotlight'
  | 'glassui'
  | 'card'
  | 'cursor'
  | 'chart'
  | 'scrollstory'
  | 'subtitle'
  | 'voice';

/** 入场动画类型 */
export type AnimationType = 'none' | 'fade' | 'slide' | 'scale';

export type EasingName = 'linear' | 'easeOut' | 'easeInOut' | 'spring';

export type SlideDirection = 'left' | 'right' | 'up' | 'down';

export interface AnimationSpec {
  type: AnimationType;
  /** 入场动画时长（秒） */
  duration: number;
  /** 相对 block.start 的延迟（秒） */
  delay: number;
  easing: EasingName;
  /** slide 专用：来向 */
  direction: SlideDirection;
  /** slide 专用：位移距离（合成坐标像素） */
  distance: number;
  /** scale 专用：起始缩放 */
  from: number;
}

export interface Position {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* 各积木的 props                                                       */
/* ------------------------------------------------------------------ */

export interface ImageProps {
  /** 素材 id，指向 store.assets */
  assetId: string | null;
  src: string | null;
  /** 后续生成或检索视觉素材的描述，可由 Agent 写入 */
  visualPrompt?: string;
  /** 原始宽度（合成坐标） */
  width: number;
  height: number;
  scale: number;
  opacity: number;
  rotation: number;
  radius: number;
}

export interface TextProps {
  text: string;
  fontSize: number;
  color: string;
  fontWeight: number;
  letterSpacing: number;
  lineHeight: number;
  opacity: number;
  align: 'left' | 'center' | 'right';
  maxWidth: number;
}

export interface VideoProps {
  assetId: string | null;
  src: string | null;
  /** 铺满整个合成作为背景层 */
  background: boolean;
  width: number;
  height: number;
  scale: number;
  opacity: number;
  loop: boolean;
  muted: boolean;
  /** 是否参与播放（关掉则始终定格在首帧） */
  playing: boolean;
  objectFit: 'cover' | 'contain';
}

export type BlockProps =
  | ImageProps
  | TextProps
  | VideoProps
  | SpotlightProps
  | GlassUIProps
  | CardProps
  | CursorProps
  | ChartProps
  | ScrollStoryProps
  | SubtitleProps
  | VoiceProps;

/* ------------------------------------------------------------------ */
/* 高级积木 props                                                       */
/* ------------------------------------------------------------------ */

/** 聚光灯：在画面上挖一个亮洞，其余压暗，用来引导视线 */
export interface SpotlightProps {
  width: number;
  height: number;
  scale: number;
  opacity: number;
  /** 聚光半径（px，画布坐标） */
  radius: number;
  /** 边缘羽化（px） */
  softness: number;
  /** 暗部浓度 0..1 */
  dim: number;
  /** 聚光染色（rgba 或 transparent），默认轻微提亮 */
  tint: string;
}

/** 玻璃拟态 UI 卡片：毛玻璃背景 + 描边 */
export interface GlassUIProps {
  width: number;
  height: number;
  scale: number;
  opacity: number;
  radius: number;
  /** 背景模糊半径（px） */
  blur: number;
  /** 玻璃底色（rgba），默认半透明白 */
  tint: string;
  /** 描边颜色（rgba） */
  border: string;
  borderWidth: number;
}

/** 信息卡片：可独立承载标题、正文和强调色 */
export interface CardProps {
  width: number;
  height: number;
  scale: number;
  opacity: number;
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
  bg: string;
  border: string;
  titleColor: string;
  bodyColor: string;
  radius: number;
  padding: number;
  align: 'left' | 'center' | 'right';
  showAccent: boolean;
}

export interface CursorProps {
  width: number;
  height: number;
  scale: number;
  opacity: number;
  endX: number;
  endY: number;
  action: 'move' | 'click' | 'double-click' | 'drag';
  cursorColor: string;
  outlineColor: string;
  clickColor: string;
  showTrail: boolean;
}

/** 图表：柱状 / 折线 / 面积 / 环形 / 进度，时间驱动入场 */
export interface ChartProps {
  width: number;
  height: number;
  scale: number;
  opacity: number;
  type: 'bar' | 'line' | 'area' | 'donut' | 'progress';
  /** 逗号分隔的数值，如 "30,55,40,72" */
  data: string;
  /** 逗号分隔的标签，数量不足时自动补齐 */
  labels: string;
  color: string;
  secondaryColor: string;
  textColor: string;
  /** 卡片背景（rgba），空则透明 */
  bg: string;
  radius: number;
  showGrid: boolean;
  showValues: boolean;
  unit: string;
  title: string;
}

/** 滚动故事：一段文字按时间匀速上滚，用于故事化字幕 / 旁白 */
export interface ScrollStoryProps {
  width: number;
  height: number;
  scale: number;
  opacity: number;
  text: string;
  fontSize: number;
  color: string;
  fontWeight: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  /** 滚动速度（px / 秒） */
  speed: number;
  /** 视口背景（rgba），空则透明 */
  bg: string;
}

/** 字幕条：底部居中的说明文字，带半透明底衬 */
export interface SubtitleProps {
  text: string;
  maxWidth: number;
  fontSize: number;
  color: string;
  /** 底衬颜色（rgba），空则无底衬 */
  bg: string;
  fontWeight: number;
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  opacity: number;
  paddingX: number;
  paddingY: number;
}

/** 配音占位：先承载文案与时间轴信息，后续接入 TTS 生成音频。 */
export interface VoiceProps {
  text: string;
  voiceName: string;
  speed: number;
  volume: number;
  src: string | null;
  duration: number;
  generated: boolean;
  /** 编辑器展示用的占位卡片尺寸与通用视觉参数。 */
  width: number;
  height: number;
  scale: number;
  opacity: number;
}

/* ------------------------------------------------------------------ */
/* 统一 Block 结构                                                      */
/* ------------------------------------------------------------------ */

export interface BaseBlock {
  id: string;
  type: BlockType;
  /** 图层面板 / 时间轴上显示的名字 */
  name: string;
  props: BlockProps;
  animation: AnimationSpec;
  position: Position;
  /** 在时间轴上的入点（秒）—— 对应 HyperFrames 的 data-start */
  start: number;
  /** 持续时长（秒）—— 对应 HyperFrames 的 data-duration */
  duration: number;
  /** 层级，越大越靠前 */
  layer: number;
  visible: boolean;
  locked: boolean;
  /** SRT 自动生成的积木可据此安全地重新生成，不影响手工积木 */
  source?: 'manual' | 'srt' | 'auto' | 'pipeline';
  sceneId?: string;
  /** Agent 生成时使用的语义布局；手动积木可以不设置。 */
  layoutPreset?: LayoutPreset;
}

export interface ImageBlockData extends BaseBlock {
  type: 'image';
  props: ImageProps;
}

export interface TextBlockData extends BaseBlock {
  type: 'text';
  props: TextProps;
}

export interface VideoBlockData extends BaseBlock {
  type: 'video';
  props: VideoProps;
}

export interface SpotlightBlockData extends BaseBlock {
  type: 'spotlight';
  props: SpotlightProps;
}

export interface GlassUIBlockData extends BaseBlock {
  type: 'glassui';
  props: GlassUIProps;
}

export interface ChartBlockData extends BaseBlock {
  type: 'chart';
  props: ChartProps;
}

export interface CardBlockData extends BaseBlock {
  type: 'card';
  props: CardProps;
}

export interface CursorBlockData extends BaseBlock {
  type: 'cursor';
  props: CursorProps;
}

export interface ScrollStoryBlockData extends BaseBlock {
  type: 'scrollstory';
  props: ScrollStoryProps;
}

export interface SubtitleBlockData extends BaseBlock {
  type: 'subtitle';
  props: SubtitleProps;
}

export interface VoiceBlockData extends BaseBlock {
  type: 'voice';
  props: VoiceProps;
}

export type Block =
  | ImageBlockData
  | TextBlockData
  | VideoBlockData
  | SpotlightBlockData
  | GlassUIBlockData
  | CardBlockData
  | CursorBlockData
  | ChartBlockData
  | ScrollStoryBlockData
  | SubtitleBlockData
  | VoiceBlockData;

/** 取指定积木类型的 props 类型 */
export type PropsOf<T extends BlockType> = Extract<Block, { type: T }>['props'];

/**
 * 类型安全的 props 局部更新。
 *
 * 旧签名是 11 种 props 的交叉类型（任何积木可写任何字段）；
 * 现在是「各类型 Partial 的联合」——补丁必须至少能匹配一种积木的
 * props，配合 store 里的运行时按键过滤，杜绝跨类型写脏数据。
 */
export type BlockPropsPatch = {
  [K in BlockType]: Partial<PropsOf<K>>;
}[BlockType];

/* ------------------------------------------------------------------ */
/* 素材库                                                              */
/* ------------------------------------------------------------------ */

export interface Asset {
  id: string;
  name: string;
  kind: 'image' | 'video';
  /** data URL；可随工程保存、恢复和导出 */
  url: string;
  width: number;
  height: number;
  /** 视频时长（秒） */
  duration?: number;
  size: number;
}

export interface NarrationTrack {
  id: string;
  name: string;
  src: string;
  duration: number;
  size: number;
}

export interface Scene {
  id: string;
  index: number;
  start: number;
  end: number;
  duration: number;
  text: string;
}

export interface CanvasConfig {
  width: number;
  height: number;
  background: string;
  fps: number;
}

/** 求值结果：某一时刻某个 block 的画面状态 */
export interface EvaluatedFrame {
  /** 是否在时间窗口内 */
  active: boolean;
  opacity: number;
  /** 动画附加位移（叠加在 position 上） */
  dx: number;
  dy: number;
  /** 动画附加缩放（乘在 props.scale 上） */
  scale: number;
  /** 相对 block 入点的本地时间，媒体同步用 */
  localTime: number;
  /** 入场动画进度 0..1 */
  progress: number;
}

/* ------------------------------------------------------------------ */
/* 工程快照：JSON 导入 / 导出                                          */
/* ------------------------------------------------------------------ */

export interface ProjectSnapshot {
  app: 'hyperframes-editor';
  version: number;
  themeId?: ThemeId;
  projectName: string;
  canvas: CanvasConfig;
  blocks: Block[];
  assets: Asset[];
  narration: NarrationTrack | null;
  scenes: Scene[];
  updatedAt: string;
}

export type ThemeId = 'midnight' | 'warm-paper' | 'cyber-glass' | 'editorial' | 'mono';
