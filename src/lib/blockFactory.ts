import type {
  AnimationSpec,
  Asset,
  Block,
  BlockType,
  CanvasConfig,
  ChartBlockData,
  CardBlockData,
  CursorBlockData,
  GlassUIBlockData,
  ImageBlockData,
  ScrollStoryBlockData,
  SpotlightBlockData,
  SubtitleBlockData,
  TextBlockData,
  VideoBlockData,
} from '@/types';

export const CANVAS_DEFAULT: CanvasConfig = {
  width: 1920,
  height: 1080,
  background: '#0b0d12',
  fps: 30,
};

export function uid(prefix = 'blk'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export const DEFAULT_ANIMATION: AnimationSpec = {
  type: 'none',
  duration: 0.6,
  delay: 0,
  easing: 'easeOut',
  direction: 'left',
  distance: 240,
  from: 0.6,
};

const BLOCK_LABEL: Record<BlockType, string> = {
  image: '图片',
  text: '文字',
  video: '视频',
  spotlight: '聚光',
  glassui: '玻璃',
  card: '信息卡片',
  cursor: '鼠标教学',
  chart: '图表',
  scrollstory: '滚动故事',
  subtitle: '字幕',
};

/** 让新素材以合适尺寸落到画布上：最长边不超过画布 60% */
function fitSize(w: number, h: number, canvas: CanvasConfig) {
  if (!w || !h) return { width: 640, height: 360 };
  const maxW = canvas.width * 0.6;
  const maxH = canvas.height * 0.6;
  const k = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

function centerPosition(w: number, h: number, canvas: CanvasConfig) {
  return {
    x: Math.round((canvas.width - w) / 2),
    y: Math.round((canvas.height - h) / 2),
  };
}

export function createImageBlock(
  asset: Asset | null,
  canvas: CanvasConfig,
  layer: number,
  start = 0,
): ImageBlockData {
  const { width, height } = fitSize(asset?.width ?? 960, asset?.height ?? 540, canvas);
  return {
    id: uid('img'),
    type: 'image',
    name: asset ? asset.name.replace(/\.[^.]+$/, '') : `${BLOCK_LABEL.image}积木`,
    props: {
      assetId: asset?.id ?? null,
      src: asset?.url ?? null,
      width,
      height,
      scale: 1,
      opacity: 1,
      rotation: 0,
      radius: 0,
    },
    animation: { ...DEFAULT_ANIMATION, type: 'fade' },
    position: centerPosition(width, height, canvas),
    start,
    duration: 4,
    layer,
    visible: true,
    locked: false,
  };
}

export function createTextBlock(canvas: CanvasConfig, layer: number, start = 0): TextBlockData {
  const maxWidth = 1000;
  return {
    id: uid('txt'),
    type: 'text',
    name: '文字积木',
    props: {
      text: '在这里输入文字',
      fontSize: 96,
      color: '#ffffff',
      fontWeight: 700,
      letterSpacing: -2,
      lineHeight: 1.15,
      opacity: 1,
      align: 'left',
      maxWidth,
    },
    animation: { ...DEFAULT_ANIMATION, type: 'slide', direction: 'up', distance: 120 },
    position: { x: Math.round((canvas.width - maxWidth) / 2), y: Math.round(canvas.height * 0.42) },
    start,
    duration: 4,
    layer,
    visible: true,
    locked: false,
  };
}

export function createVideoBlock(
  asset: Asset | null,
  canvas: CanvasConfig,
  layer: number,
  start = 0,
): VideoBlockData {
  const { width, height } = fitSize(asset?.width ?? 1280, asset?.height ?? 720, canvas);
  return {
    id: uid('vid'),
    type: 'video',
    name: asset ? asset.name.replace(/\.[^.]+$/, '') : '视频积木',
    props: {
      assetId: asset?.id ?? null,
      src: asset?.url ?? null,
      background: false,
      width,
      height,
      scale: 1,
      opacity: 1,
      loop: true,
      muted: true,
      playing: true,
      objectFit: 'cover',
    },
    animation: { ...DEFAULT_ANIMATION, type: 'fade', duration: 0.8 },
    position: centerPosition(width, height, canvas),
    start,
    // 视频默认时长跟随素材，封顶 10 秒，避免一进来时间轴就拉得太长
    duration: asset?.duration ? Math.min(10, Math.max(1, asset.duration)) : 6,
    layer,
    visible: true,
    locked: false,
  };
}

export function createSpotlightBlock(
  canvas: CanvasConfig,
  layer: number,
  start = 0,
): SpotlightBlockData {
  const width = 900;
  const height = 900;
  return {
    id: uid('spt'),
    type: 'spotlight',
    name: '聚光积木',
    props: {
      width,
      height,
      scale: 1,
      opacity: 1,
      radius: 260,
      softness: 120,
      dim: 0.78,
      tint: 'rgba(255,255,255,0.05)',
    },
    animation: { ...DEFAULT_ANIMATION, type: 'fade', duration: 0.6 },
    position: centerPosition(width, height, canvas),
    start,
    duration: 4,
    layer,
    visible: true,
    locked: false,
  };
}

export function createGlassUIBlock(
  canvas: CanvasConfig,
  layer: number,
  start = 0,
): GlassUIBlockData {
  const width = 720;
  const height = 360;
  return {
    id: uid('glz'),
    type: 'glassui',
    name: '玻璃卡片',
    props: {
      width,
      height,
      scale: 1,
      opacity: 1,
      radius: 24,
      blur: 18,
      tint: 'rgba(255,255,255,0.10)',
      border: 'rgba(255,255,255,0.28)',
      borderWidth: 1,
    },
    animation: { ...DEFAULT_ANIMATION, type: 'scale', from: 0.85, duration: 0.5 },
    position: centerPosition(width, height, canvas),
    start,
    duration: 4,
    layer,
    visible: true,
    locked: false,
  };
}

export function createChartBlock(
  canvas: CanvasConfig,
  layer: number,
  start = 0,
): ChartBlockData {
  const width = 800;
  const height = 460;
  return {
    id: uid('cht'),
    type: 'chart',
    name: '图表积木',
    props: {
      width,
      height,
      scale: 1,
      opacity: 1,
      type: 'bar',
      data: '30,55,40,72,25,60',
      labels: '一月,二月,三月,四月,五月,六月',
      color: '#a3e635',
      secondaryColor: '#38bdf8',
      textColor: '#ffffff',
      bg: 'rgba(255,255,255,0.04)',
      radius: 16,
      showGrid: true,
      showValues: true,
      unit: '',
      title: '数据标题',
    },
    animation: { ...DEFAULT_ANIMATION, type: 'scale', from: 0.9, duration: 0.5 },
    position: centerPosition(width, height, canvas),
    start,
    duration: 4,
    layer,
    visible: true,
    locked: false,
  };
}

export function createCardBlock(
  canvas: CanvasConfig,
  layer: number,
  start = 0,
): CardBlockData {
  const width = 760;
  const height = 400;
  return {
    id: uid('crd'),
    type: 'card',
    name: '信息卡片',
    props: {
      width,
      height,
      scale: 1,
      opacity: 1,
      eyebrow: 'HYPERFRAMES',
      title: '一个清晰有力的标题',
      body: '用这张卡片承载关键结论、步骤说明或数据摘要。',
      accent: '#5b8cff',
      bg: 'rgba(16,20,30,0.92)',
      border: 'rgba(255,255,255,0.14)',
      titleColor: '#ffffff',
      bodyColor: 'rgba(255,255,255,0.68)',
      radius: 28,
      padding: 52,
      align: 'left',
      showAccent: true,
    },
    animation: { ...DEFAULT_ANIMATION, type: 'scale', from: 0.9, duration: 0.5 },
    position: centerPosition(width, height, canvas),
    start,
    duration: 4,
    layer,
    visible: true,
    locked: false,
  };
}

export function createCursorBlock(
  canvas: CanvasConfig,
  layer: number,
  start = 0,
): CursorBlockData {
  const width = 92;
  const height = 92;
  const position = { x: Math.round(canvas.width * 0.25), y: Math.round(canvas.height * 0.65) };
  return {
    id: uid('cur'),
    type: 'cursor',
    name: '鼠标教学',
    props: {
      width,
      height,
      scale: 1,
      opacity: 1,
      endX: Math.round(canvas.width * 0.7),
      endY: Math.round(canvas.height * 0.35),
      action: 'click',
      cursorColor: '#ffffff',
      outlineColor: '#111827',
      clickColor: '#5b8cff',
      showTrail: true,
    },
    animation: { ...DEFAULT_ANIMATION, type: 'fade', duration: 0.18 },
    position,
    start,
    duration: 2.2,
    layer,
    visible: true,
    locked: false,
  };
}

export function createScrollStoryBlock(
  canvas: CanvasConfig,
  layer: number,
  start = 0,
): ScrollStoryBlockData {
  const width = 720;
  const height = 420;
  return {
    id: uid('scr'),
    type: 'scrollstory',
    name: '滚动故事',
    props: {
      width,
      height,
      scale: 1,
      opacity: 1,
      text: '这是一段会自己往上滚的文字。\n\n把长文案、旁白、要点塞进来，\n它就会跟着时间轴匀速上滚，\n适合做故事化字幕。',
      fontSize: 40,
      color: '#ffffff',
      fontWeight: 500,
      lineHeight: 1.5,
      align: 'left',
      speed: 60,
      bg: 'rgba(0,0,0,0.35)',
    },
    animation: { ...DEFAULT_ANIMATION, type: 'fade', duration: 0.6 },
    position: centerPosition(width, height, canvas),
    start,
    duration: 6,
    layer,
    visible: true,
    locked: false,
  };
}

export function createSubtitleBlock(
  canvas: CanvasConfig,
  layer: number,
  start = 0,
): SubtitleBlockData {
  const maxWidth = 1200;
  return {
    id: uid('sub'),
    type: 'subtitle',
    name: '字幕条',
    props: {
      text: '在这里输入字幕文字',
      maxWidth,
      fontSize: 64,
      color: '#ffffff',
      bg: 'rgba(0,0,0,0.55)',
      fontWeight: 600,
      letterSpacing: 0,
      lineHeight: 1.3,
      align: 'center',
      opacity: 1,
      paddingX: 28,
      paddingY: 14,
    },
    animation: { ...DEFAULT_ANIMATION, type: 'fade', duration: 0.4 },
    position: { x: Math.round((canvas.width - maxWidth) / 2), y: canvas.height - 160 },
    start,
    duration: 4,
    layer,
    visible: true,
    locked: false,
  };
}

/** 视频作为背景层时，占满整个合成 */
export function resolveBox(block: Block, canvas: CanvasConfig) {
  if (block.type === 'video' && block.props.background) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height, scale: 1 };
  }
  if (block.type === 'text' || block.type === 'subtitle') {
    const maxWidth = (block.props as { maxWidth: number }).maxWidth;
    return {
      x: block.position.x,
      y: block.position.y,
      width: maxWidth,
      height: 0,
      scale: 1,
    };
  }
  const props = block.props as { width: number; height: number; scale: number };
  return {
    x: block.position.x,
    y: block.position.y,
    width: props.width,
    height: props.height,
    scale: props.scale,
  };
}

export const BLOCK_COLOR: Record<BlockType, string> = {
  image: '#4dd4ac',
  text: '#ffb86b',
  video: '#c084fc',
  spotlight: '#f472b6',
  glassui: '#38bdf8',
  card: '#5b8cff',
  cursor: '#f8fafc',
  chart: '#a3e635',
  scrollstory: '#fbbf24',
  subtitle: '#fb7185',
};
