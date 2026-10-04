const { contextBridge, ipcRenderer } = require('electron');

console.log('preload loaded');

contextBridge.exposeInMainWorld('hyperframesElectron', {
  generateProductProject: (input) => {
    console.log('4 preload generateProductProject');
    console.log('preload: generateProductProject');
    return ipcRenderer.invoke('generate-product-project', input);
  },
  loadAsset: (assetPath) => ipcRenderer.invoke('load-asset', assetPath),
  selectSourceMedia: () => ipcRenderer.invoke('select-source-media'),
  inspectSourceMedia: (paths) => ipcRenderer.invoke('inspect-source-media', paths),
  inspectArchiveSourceReferences: (paths) => ipcRenderer.invoke('inspect-archive-source-references', paths),
  selectArchiveRelocationCandidate: () => ipcRenderer.invoke('select-archive-relocation-candidate'),
  registerSourceMedia: (mediaPath) => ipcRenderer.invoke('register-source-media', mediaPath),
  generateSourceProxy: (sourceId, sourcePath) => ipcRenderer.invoke('generate-source-proxy', sourceId, sourcePath),
  cancelSourceProxy: (sourceId) => ipcRenderer.invoke('cancel-source-proxy', sourceId),
  generateSourceWaveform: (sourcePath) => ipcRenderer.invoke('generate-source-waveform', sourcePath),
  generateSourceVisualCheckpoint: (sourcePath, start, end) => ipcRenderer.invoke('generate-source-visual-checkpoint', sourcePath, start, end),
  generateSourceVisualIndex: (sourcePath, maxFrames, interval) => ipcRenderer.invoke('generate-source-visual-index', sourcePath, maxFrames, interval),
  generateSourceVisualRefinement: (sourcePath, start, end, maxFrames) => ipcRenderer.invoke('generate-source-visual-refinement', sourcePath, start, end, maxFrames),
  getSourceVisualUnderstandingCapabilities: () => ipcRenderer.invoke('get-source-visual-understanding-capabilities'),
  probeSourceVisualUnderstandingProvider: (providerId) => ipcRenderer.invoke('probe-source-visual-understanding-provider', providerId),
  analyzeSourceVisualFrames: (frames, providerId) => ipcRenderer.invoke('analyze-source-visual-frames', frames, providerId),
  generateSourceStoryPreview: (request) => ipcRenderer.invoke('generate-source-story-preview', request),
  cancelSourceStoryPreview: (jobId) => ipcRenderer.invoke('cancel-source-story-preview', jobId),
  onSourceStoryPreviewProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('source-story-preview-progress', handler);
    return () => ipcRenderer.removeListener('source-story-preview-progress', handler);
  },
  getSourceTranscriptionCapabilities: () => ipcRenderer.invoke('get-source-transcription-capabilities'),
  startSourceTranscription: (sourceId, sourcePath, options) => ipcRenderer.invoke('start-source-transcription', sourceId, sourcePath, options),
  cancelSourceTranscription: (jobId) => ipcRenderer.invoke('cancel-source-transcription', jobId),
  onSourceProxyProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('source-proxy-progress', handler);
    return () => ipcRenderer.removeListener('source-proxy-progress', handler);
  },
  onSourceTranscriptionProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('source-transcription-progress', handler);
    return () => ipcRenderer.removeListener('source-transcription-progress', handler);
  },
  onSourceTranscriptionResult: (listener) => {
    const handler = (_event, result) => listener(result);
    ipcRenderer.on('source-transcription-result', handler);
    return () => ipcRenderer.removeListener('source-transcription-result', handler);
  },
  onSourceTranscriptionError: (listener) => {
    const handler = (_event, failure) => listener(failure);
    ipcRenderer.on('source-transcription-error', handler);
    return () => ipcRenderer.removeListener('source-transcription-error', handler);
  },
  exportDeliveryPackage: (payload) => ipcRenderer.invoke('export-delivery-package', payload),
  exportWinningStoryHandoff: (payload) => ipcRenderer.invoke('export-winning-story-handoff', payload),
  revealPath: (targetPath) => ipcRenderer.invoke('reveal-path', targetPath),
  startReleaseRender: (request) => ipcRenderer.invoke('start-release-render', request),
  cancelReleaseRender: (jobId) => ipcRenderer.invoke('cancel-release-render', jobId),
  getReleaseRenderStatus: () => ipcRenderer.invoke('get-release-render-status'),
  onReleaseRenderProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('release-render-progress', handler);
    return () => ipcRenderer.removeListener('release-render-progress', handler);
  },
  onReleaseRenderResult: (listener) => {
    const handler = (_event, result) => listener(result);
    ipcRenderer.on('release-render-result', handler);
    return () => ipcRenderer.removeListener('release-render-result', handler);
  },
});
