import { createRoot } from 'react-dom/client';
import type { ProjectSnapshot } from '@/types';
import { HyperFramesPlayer } from './HyperFramesPlayer';

/**
 * 导出 HTML 的 IIFE 入口。
 *
 * 打包产物（src/generated/hf-player.iife.js）被 exportHtml.ts 以 ?raw 方式
 * 内联进导出的单文件 HTML，因此导出页面运行的就是编辑器同一套积木实现。
 */

declare global {
  interface Window {
    __HF_MOUNT_PLAYER?: (container: HTMLElement, project: ProjectSnapshot) => void;
    __HF_SEEK?: (t: number) => void;
    __HF_PLAY?: () => void;
    __HF_PAUSE?: () => void;
    __HF_PROJECT?: ProjectSnapshot;
    __HF_DURATION?: number;
  }
}

export function mountPlayer(container: HTMLElement, project: ProjectSnapshot): void {
  const root = createRoot(container);
  root.render(<HyperFramesPlayer project={project} />);
}

if (typeof window !== 'undefined') {
  window.__HF_MOUNT_PLAYER = mountPlayer;

  // 渲染模式：隐藏控制条，由 tools/html-to-mp4.mjs 驱动逐帧截图
  if (new URLSearchParams(window.location.search).get('render') === '1') {
    document.body.classList.add('render-mode');
  }
}
