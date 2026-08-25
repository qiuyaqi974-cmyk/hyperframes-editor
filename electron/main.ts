import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { runProductProject } from './runtime.mjs';
import { loadLocalEnv } from '../server/loadLocalEnv';

interface ProductProjectInput {
  folderPath?: string;
  productInfo?: {
    productName?: string;
    targetAudience?: string;
    sellingPoints?: string[];
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

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

ipcMain.handle('load-video-asset', async (_event, assetPath: string) => {
  try {
    const filePath = assetPath.startsWith('file://') ? fileURLToPath(assetPath) : assetPath;
    const extension = extname(filePath).toLowerCase();
    if (extension !== '.mp4' && extension !== '.webm') throw new Error('仅支持 MP4 和 WebM 视频。');
    const buffer = readFileSync(filePath);
    const mime = extension === '.webm' ? 'video/webm' : 'video/mp4';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error('main: load video asset failed', error);
    throw error;
  }
});

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
