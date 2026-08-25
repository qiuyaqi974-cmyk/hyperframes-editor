import playerJs from '@/generated/hf-player.iife.js?raw';
import playerCss from '@/generated/hf-player.css?raw';
import type { ProjectSnapshot } from '@/types';

/**
 * 导出自包含 HyperFrames HTML。
 *
 * 渲染实现不再内联手写第二份运行时，而是直接嵌入
 * src/generated/ 下的播放器产物（由 scripts/build-player.mjs 从
 * 编辑器同一套积木组件打包而来），从机制上保证：
 *   编辑器画面 = 导出 HTML 画面 = MP4 逐帧渲染画面。
 *
 * 若改动积木组件或播放器，请运行 `npm run player:build` 重新生成产物。
 */
export function generateHyperFramesHtml(project: ProjectSnapshot): string {
  const payload = JSON.stringify(project).replace(/</g, '\\u003c');
  const title = project.projectName.replace(/[<>&"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
  })[char] ?? char);
  // 防止打包产物中出现 </script> 提前闭合标签
  const inlinePlayerJs = playerJs.replace(/<\/script>/gi, '<\\/script>');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title} · HyperFrames</title>
<style>${playerCss}</style>
</head>
<body>
<div id="root"></div>
<script>${inlinePlayerJs}</script>
<script>window.__HF_MOUNT_PLAYER(document.getElementById('root'), ${payload});</script>
</body>
</html>`;
}
