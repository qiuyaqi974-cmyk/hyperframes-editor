import { contextBridge, ipcRenderer } from 'electron';
import type { ProductProjectInput } from '../src/lib/agent/productProjectAgent';
import type { ProjectSnapshot } from '../src/types';

contextBridge.exposeInMainWorld('hyperframesElectron', {
  generateProductProject: (input: ProductProjectInput): Promise<{ snapshot: ProjectSnapshot }> => {
    console.log('preload: generateProductProject');
    return ipcRenderer.invoke('generate-product-project', input);
  },
});
