import { contextBridge, ipcRenderer } from 'electron';
console.log('preload loaded');

contextBridge.exposeInMainWorld('hyperframesElectron', {
  generateProductProject: (): Promise<{ ok: true }> => {
    console.log('preload: generateProductProject');
    return ipcRenderer.invoke('generate-product-project');
  },
});
