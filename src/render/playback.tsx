import { createContext, useContext } from 'react';

/**
 * 播放状态上下文。
 *
 * 积木组件（如 VideoBlock）需要知道「当前是否在播放」来决定媒体元素跟帧还是暂停。
 * 编辑器和导出播放器是两个不同的宿主，所以这里不直接依赖 editorStore，
 * 而是由宿主通过 Provider 注入——这是「编辑器画面 = 导出画面」能共用同一套
 * 积木实现的前提。
 */
const PlaybackContext = createContext<{ isPlaying: boolean }>({ isPlaying: false });

export function PlaybackProvider({
  isPlaying,
  children,
}: {
  isPlaying: boolean;
  children: React.ReactNode;
}) {
  return (
    <PlaybackContext.Provider value={{ isPlaying }}>{children}</PlaybackContext.Provider>
  );
}

export function usePlaybackState(): boolean {
  return useContext(PlaybackContext).isPlaying;
}
