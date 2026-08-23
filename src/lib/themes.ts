import type { Block, ThemeId } from '@/types';

export interface ThemePreset {
  id: ThemeId;
  name: string;
  background: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  surface: string;
  border: string;
  subtitle: string;
}

export const THEMES: Record<ThemeId, ThemePreset> = {
  midnight: { id: 'midnight', name: '深夜蓝', background: '#0b0d12', text: '#ffffff', muted: 'rgba(255,255,255,0.68)', accent: '#5b8cff', accent2: '#a3e635', surface: 'rgba(16,20,30,0.92)', border: 'rgba(255,255,255,0.14)', subtitle: 'rgba(0,0,0,0.58)' },
  'warm-paper': { id: 'warm-paper', name: '暖纸杂志', background: '#f1e7d4', text: '#241d17', muted: 'rgba(36,29,23,0.66)', accent: '#d45a3a', accent2: '#287271', surface: 'rgba(255,250,240,0.94)', border: 'rgba(75,48,30,0.20)', subtitle: 'rgba(255,250,240,0.88)' },
  'cyber-glass': { id: 'cyber-glass', name: '赛博玻璃', background: '#07131f', text: '#e9fbff', muted: 'rgba(210,246,255,0.66)', accent: '#00e5ff', accent2: '#bb5cff', surface: 'rgba(8,35,54,0.78)', border: 'rgba(0,229,255,0.30)', subtitle: 'rgba(3,17,29,0.78)' },
  editorial: { id: 'editorial', name: '红黑社论', background: '#f6f3ed', text: '#171717', muted: 'rgba(23,23,23,0.62)', accent: '#e32929', accent2: '#171717', surface: '#ffffff', border: 'rgba(23,23,23,0.18)', subtitle: 'rgba(255,255,255,0.90)' },
  mono: { id: 'mono', name: '极简黑白', background: '#111111', text: '#f4f4f4', muted: 'rgba(244,244,244,0.62)', accent: '#f4f4f4', accent2: '#8a8a8a', surface: '#1c1c1c', border: 'rgba(255,255,255,0.18)', subtitle: 'rgba(0,0,0,0.72)' },
};

export const THEME_LIST = Object.values(THEMES);

export function styleBlockForTheme(block: Block, theme: ThemePreset): Block {
  const b = { ...block, props: { ...block.props } } as Block;
  if (b.type === 'text') b.props = { ...b.props, color: theme.text };
  if (b.type === 'subtitle') b.props = { ...b.props, color: theme.text, bg: theme.subtitle };
  if (b.type === 'chart') b.props = { ...b.props, color: theme.accent, secondaryColor: theme.accent2, textColor: theme.text, bg: theme.surface };
  if (b.type === 'card') b.props = { ...b.props, accent: theme.accent, bg: theme.surface, border: theme.border, titleColor: theme.text, bodyColor: theme.muted };
  if (b.type === 'cursor') b.props = { ...b.props, clickColor: theme.accent };
  if (b.type === 'glassui') b.props = { ...b.props, tint: theme.surface, border: theme.border };
  if (b.type === 'scrollstory') b.props = { ...b.props, color: theme.text, bg: theme.surface };
  return b;
}
