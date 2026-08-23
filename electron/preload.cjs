const { contextBridge, ipcRenderer } = require('electron');

console.log('preload loaded');

contextBridge.exposeInMainWorld('hyperframesElectron', {
  generateProductProject: () => {
    console.log('preload: generateProductProject');
    return ipcRenderer.invoke('generate-product-project');
  },
});
