import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { runProductProject } from './runtime.mjs';
import { loadLocalEnv } from '../server/loadLocalEnv';
import { writeDeliveryPackage } from './deliveryPackage';
import type { DeliveryPackagePayload } from '../src/lib/exportDeliveryPackage';
import type { DirectorDecision } from '../src/types';
import type { ReleaseRenderRequest } from '../src/lib/releaseRender';
import { cancelReleaseRender, defaultRenderFilename, getReleaseRenderStatus, startReleaseRender } from './releaseRenderer';
import { cancelSourceProxy, generateSourceProxy, generateSourceVisualCheckpoint, generateSourceWaveform, inspectSourceMedia, isSupportedSource } from './sourceMedia';
import { generateSourceVisualIndex, generateSourceVisualRefinement } from './sourceVisualIndex';
import { analyzeSourceVisualFrames, getSourceVisualUnderstandingCapabilities, probeSourceVisualUnderstandingProvider } from './sourceVisualUnderstanding';
import type { VisualUnderstandingFrame } from '../src/lib/sourceVisualUnderstanding';
import { cancelSourceTranscription, getSourceTranscriptionCapabilities, startSourceTranscription } from './sourceTranscription';
import { cancelSourceStoryPreview, generateSourceStoryPreview } from './sourceStoryPreview';
import type { SourceStoryPreviewRequest } from '../src/lib/sourceStoryPreview';
import type { WinningStoryHandoffPayload } from '../src/lib/sourceStoryHandoff';
import { writeWinningStoryHandoff } from './storyHandoff';
import { inspectArchiveSourceReference, inspectArchiveSourceReferences } from './projectArchive';

interface ProductProjectInput {
  folderPath?: string;
  productInfo?: {
    productName?: string;
    targetAudience?: string;
    sellingPoints?: string[];
  };
  director?: DirectorDecision;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const mediaRegistry = new Map<string, string>();

protocol.registerSchemesAsPrivileged([{
  scheme: 'hf-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

function registerMediaPath(mediaPath: string) {
  const filePath = mediaPath.startsWith('file://') ? fileURLToPath(mediaPath) : mediaPath;
  if (!isSupportedSource(filePath)) throw new Error('本地视频不存在或格式不支持。');
  const token = createHash('sha256').update(filePath.toLowerCase()).digest('hex').slice(0, 24);
  mediaRegistry.set(token, filePath);
  return { url: `hf-media://local/${token}`, path: filePath };
}

// 与 vite.config.ts 共用同一份 .env.local 加载逻辑（模块加载时即生效）
loadLocalEnv();

function createWindow() {
  const window = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      devTools: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Electron 运行时加载无类型的桥接脚本；preload.ts 是对应的类型化源码。
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  const url = 'http://127.0.0.1:5178';
  console.log('loading url', url);
  void window.loadURL(url).then(() => {
    window.webContents.openDevTools();
  }).catch((error) => {
    console.error('failed to load url', error);
  });
}

ipcMain.handle('generate-product-project', async (_event, input: ProductProjectInput = {}) => {
  console.log('5 ipc received');
  console.log('ipc generate-product-project received');
  try {
    const selected = await dialog.showOpenDialog({
      title: '选择商品素材文件夹',
      properties: ['openDirectory'],
    });
    if (selected.canceled || !selected.filePaths[0]) throw new Error('未选择商品素材文件夹。');
    console.log('6 folder selected', selected.filePaths[0]);
    console.log('7 start productProjectAgent');
    const productInfo = input.productInfo ?? {};
    const result = await runProductProject({
      folderPath: selected.filePaths[0],
      productInfo: {
        productName: String(productInfo.productName ?? '未知商品').trim() || '未知商品',
        targetAudience: String(productInfo.targetAudience ?? '普通消费者').trim() || '普通消费者',
        sellingPoints: (productInfo.sellingPoints ?? []).map((point) => String(point ?? '').trim()).filter(Boolean),
      },
      director: input.director,
    });
    return { snapshot: result.snapshot, assetInsights: result.assetInsights };
  } catch (error) {
    console.error(error);
    console.error('main: product project failed', error);
    throw error;
  }
});

ipcMain.handle('load-asset', async (_event, assetPath: string) => {
  try {
    const filePath = assetPath.startsWith('file://') ? fileURLToPath(assetPath) : assetPath;
    const buffer = readFileSync(filePath);
    const mimeByExtension: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    const mime = mimeByExtension[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error('main: load asset failed', error);
    throw error;
  }
});

ipcMain.handle('select-source-media', async () => {
  const selected = await dialog.showOpenDialog({
    title: '选择长视频原片（不会复制或改写）',
    buttonLabel: '引用这些原片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '视频素材', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
  });
  if (selected.canceled) return { canceled: true, sources: [] };
  const sources = await Promise.all(selected.filePaths.map(inspectSourceMedia));
  return { canceled: false, sources };
});

ipcMain.handle('inspect-source-media', async (_event, paths: string[]) => Promise.all(paths.map(inspectSourceMedia)));
ipcMain.handle('inspect-archive-source-references', (_event, paths: string[]) => inspectArchiveSourceReferences(paths));
ipcMain.handle('select-archive-relocation-candidate', async () => {
  const selected = await dialog.showOpenDialog({
    title: '选择这条归档原片的候选文件',
    buttonLabel: '核对此候选',
    properties: ['openFile'],
    filters: [{ name: '视频素材', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
  });
  if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
  return { canceled: false, inspection: await inspectArchiveSourceReference(selected.filePaths[0]) };
});
ipcMain.handle('register-source-media', (_event, mediaPath: string) => registerMediaPath(mediaPath));
ipcMain.handle('generate-source-proxy', async (event, sourceId: string, sourcePath: string) => {
  const result = await generateSourceProxy(event.sender, sourceId, sourcePath, join(app.getPath('userData'), 'media-proxies'));
  return { ...result, ...registerMediaPath(result.proxyPath) };
});
ipcMain.handle('cancel-source-proxy', (_event, sourceId: string) => ({ canceled: cancelSourceProxy(sourceId) }));
ipcMain.handle('generate-source-waveform', async (_event, sourcePath: string) => ({ peaks: await generateSourceWaveform(sourcePath) }));
ipcMain.handle('generate-source-visual-checkpoint', (_event, sourcePath: string, start: number, end: number) =>
  generateSourceVisualCheckpoint(sourcePath, start, end, join(app.getPath('userData'), 'visual-checkpoints')));
ipcMain.handle('generate-source-visual-index', (_event, sourcePath: string, maxFrames: number, interval: number) =>
  generateSourceVisualIndex(sourcePath, join(app.getPath('userData'), 'visual-index'), maxFrames, interval));
ipcMain.handle('generate-source-visual-refinement', (_event, sourcePath: string, start: number, end: number, maxFrames: number) =>
  generateSourceVisualRefinement(sourcePath, join(app.getPath('userData'), 'visual-index'), start, end, maxFrames));
ipcMain.handle('get-source-visual-understanding-capabilities', () => getSourceVisualUnderstandingCapabilities());
ipcMain.handle('probe-source-visual-understanding-provider', (_event, providerId: 'openai' | 'local-openai') => probeSourceVisualUnderstandingProvider(providerId));
ipcMain.handle('analyze-source-visual-frames', (_event, frames: VisualUnderstandingFrame[], providerId: 'openai' | 'local-openai') => analyzeSourceVisualFrames(frames, providerId));
ipcMain.handle('generate-source-story-preview', async (event, request: SourceStoryPreviewRequest) => {
  const result = await generateSourceStoryPreview(event.sender, request, join(app.getPath('userData'), 'story-previews'));
  return { ...result, ...registerMediaPath(result.path) };
});
ipcMain.handle('cancel-source-story-preview', (_event, jobId: string) => ({ canceled: cancelSourceStoryPreview(jobId) }));
ipcMain.handle('get-source-transcription-capabilities', () => getSourceTranscriptionCapabilities(join(__dirname, '..', 'tools', 'transcribe-local.py')));
ipcMain.handle('start-source-transcription', (event, sourceId: string, sourcePath: string, options: { model: string; language: string }) =>
  startSourceTranscription(
    event.sender,
    sourceId,
    sourcePath,
    options,
    join(app.getPath('userData'), 'transcripts'),
    join(__dirname, '..', 'tools', 'transcribe-local.py'),
  ));
ipcMain.handle('cancel-source-transcription', (_event, jobId: string) => ({ canceled: cancelSourceTranscription(jobId) }));

ipcMain.handle('export-delivery-package', async (_event, payload: DeliveryPackagePayload) => {
  const selected = await dialog.showOpenDialog({
    title: '选择交付包保存位置',
    buttonLabel: '导出到这里',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
  const outputPath = writeDeliveryPackage(selected.filePaths[0], payload);
  return { canceled: false, outputPath };
});

ipcMain.handle('export-winning-story-handoff', async (_event, payload: WinningStoryHandoffPayload) => {
  const selected = await dialog.showOpenDialog({
    title: '选择胜出方案精剪交接包保存位置',
    buttonLabel: '校验原片并导出',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
  const result = await writeWinningStoryHandoff(selected.filePaths[0], payload);
  return { canceled: false, ...result };
});

ipcMain.handle('reveal-path', async (_event, targetPath: string) => shell.openPath(targetPath));

ipcMain.handle('start-release-render', async (event, request: ReleaseRenderRequest) => {
  const selected = await dialog.showSaveDialog({
    title: `渲染 ${request.candidateLabel}`,
    buttonLabel: '开始渲染',
    defaultPath: join(app.getPath('videos'), defaultRenderFilename(request)),
    filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
  });
  if (selected.canceled || !selected.filePath) return { canceled: true };
  const outputPath = selected.filePath.toLowerCase().endsWith('.mp4') ? selected.filePath : `${selected.filePath}.mp4`;
  const result = startReleaseRender(
    event.sender,
    request,
    outputPath,
    join(__dirname, '..', 'tools', 'html-to-mp4.mjs'),
  );
  return { canceled: false, ...result };
});

ipcMain.handle('cancel-release-render', (_event, jobId: string) => ({ canceled: cancelReleaseRender(jobId) }));
ipcMain.handle('get-release-render-status', () => getReleaseRenderStatus());

void app.whenReady().then(() => {
  protocol.handle('hf-media', (request) => {
    const token = new URL(request.url).pathname.replace(/^\//, '');
    const mediaPath = mediaRegistry.get(token);
    if (!mediaPath) return new Response('Media reference expired.', { status: 404 });
    return net.fetch(pathToFileURL(mediaPath).toString(), { headers: request.headers });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
