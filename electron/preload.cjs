const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hyperframesElectron', {
  generateProductProject: (input) => ipcRenderer.invoke('product-project:generate', input),
});
