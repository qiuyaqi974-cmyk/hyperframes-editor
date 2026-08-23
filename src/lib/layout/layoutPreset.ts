export type LayoutPreset =
  | 'top-title'
  | 'center-product'
  | 'bottom-subtitle'
  | 'feature-card'
  | 'cta';

export interface LayoutPosition {
  x: number;
  y: number;
}

const POSITIONS: Record<LayoutPreset, LayoutPosition> = {
  'top-title': { x: 540, y: 180 },
  'center-product': { x: 540, y: 650 },
  'bottom-subtitle': { x: 540, y: 1600 },
  'feature-card': { x: 540, y: 1100 },
  cta: { x: 540, y: 1500 },
};

/** 把 Agent 的语义布局名转换成 HyperFrames 现有坐标。 */
export function getLayoutPosition(preset: LayoutPreset): LayoutPosition {
  return { ...POSITIONS[preset] };
}
