const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hyperframesElectron', {
  generateProductProject: (input) => {
    console.log('preload: generateProductProject');
    return ipcRenderer.invoke('generate-product-project', input);
  },
});
