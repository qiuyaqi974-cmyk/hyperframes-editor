import { contextBridge, ipcRenderer } from 'electron';
console.log('preload loaded');

contextBridge.exposeInMainWorld('hyperframesElectron', {
  generateProductProject: (): Promise<{ ok: true }> => {
    console.log('4 preload generateProductProject');
    console.log('preload: generateProductProject');
    return ipcRenderer.invoke('generate-product-project');
  },
  loadAsset: (assetPath: string): Promise<string> => ipcRenderer.invoke('load-asset', assetPath),
  loadVideoAsset: (assetPath: string): Promise<string> => ipcRenderer.invoke('load-video-asset', assetPath),
});
