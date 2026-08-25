import type { Block } from '@/types';
import ImageSection from './ImageSection';
import TextSection from './TextSection';
import VideoSection from './VideoSection';
import SpotlightSection from './SpotlightSection';
import GlassUISection from './GlassUISection';
import ChartSection from './ChartSection';
import CursorSection from './CursorSection';
import CardSection from './CardSection';
import ScrollStorySection from './ScrollStorySection';
import SubtitleSection from './SubtitleSection';
import VoiceSection from './VoiceSection';

/**
 * 积木类型 → 属性面板 section 注册表。
 *
 * 新增积木时：写一个 XxxSection，在这里注册一行即可，
 * 不再需要改动 PropertyPanel 主体。
 */
export const PROPERTY_SECTIONS: {
  [K in Block['type']]: React.FC<{ block: Extract<Block, { type: K }> }>;
} = {
  image: ImageSection,
  text: TextSection,
  video: VideoSection,
  spotlight: SpotlightSection,
  glassui: GlassUISection,
  chart: ChartSection,
  cursor: CursorSection,
  card: CardSection,
  scrollstory: ScrollStorySection,
  subtitle: SubtitleSection,
  voice: VoiceSection,
};
