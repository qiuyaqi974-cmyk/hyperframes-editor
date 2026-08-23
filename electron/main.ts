import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { runProductProject } from './runtime.mjs';

interface ProductProjectInput {
  folderPath?: string;
  productInfo?: {
    productName?: string;
    targetAudience?: string;
    sellingPoints?: string[];
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  try {
    const envPath = join(__dirname, '..', '.env.local');
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // .env.local 是可选的，也可以直接在启动 Electron 前设置环境变量。
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Electron 运行时加载无类型的桥接脚本；preload.ts 是对应的类型化源码。
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  void window.loadURL('http://localhost:5178');
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
    return { snapshot: result.snapshot };
  } catch (error) {
    console.error(error);
    console.error('main: product project failed', error);
    throw error;
  }
});

void app.whenReady().then(() => {
  loadLocalEnv();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
