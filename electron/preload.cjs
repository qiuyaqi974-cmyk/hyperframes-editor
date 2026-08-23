const { contextBridge, ipcRenderer } = require('electron');

console.log('preload loaded');

contextBridge.exposeInMainWorld('hyperframesElectron', {
  generateProductProject: () => {
    console.log('4 preload generateProductProject');
    console.log('preload: generateProductProject');
    return ipcRenderer.invoke('generate-product-project');
  },
});
