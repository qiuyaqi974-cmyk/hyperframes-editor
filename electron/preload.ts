import { contextBridge, ipcRenderer } from 'electron';
import type { DeliveryPackagePayload } from '../src/lib/exportDeliveryPackage';
import type { ReleaseRenderProgress, ReleaseRenderRequest, ReleaseRenderResult, ReleaseRenderStatusSnapshot } from '../src/lib/releaseRender';
import type { SourceMediaInspection } from '../src/lib/sourceMedia';
import type { SourceTranscriptionCapabilities, SourceTranscriptionFailure, SourceTranscriptionProgress, SourceTranscriptionResult } from '../src/lib/sourceTranscription';
import type { SourceVisualCheckpointResult } from '../src/lib/sourceVisualCheckpoint';
import type { SourceVisualIndexResult } from '../src/lib/sourceVisualIndex';
import type { VisualUnderstandingCapabilities, VisualUnderstandingFrame, VisualUnderstandingProviderCapability, VisualUnderstandingProviderProbe, VisualUnderstandingResult } from '../src/lib/sourceVisualUnderstanding';
import type { SourceStoryPreviewProgress, SourceStoryPreviewRequest, SourceStoryPreviewResult } from '../src/lib/sourceStoryPreview';
import type { WinningStoryHandoffPayload } from '../src/lib/sourceStoryHandoff';
import type { ArchiveSourceInspection } from '../src/lib/projectArchive';
console.log('preload loaded');

contextBridge.exposeInMainWorld('hyperframesElectron', {
  generateProductProject: (input: unknown) => {
    console.log('4 preload generateProductProject');
    console.log('preload: generateProductProject');
    return ipcRenderer.invoke('generate-product-project', input);
  },
  loadAsset: (assetPath: string): Promise<string> => ipcRenderer.invoke('load-asset', assetPath),
  selectSourceMedia: (): Promise<{ canceled: boolean; sources: SourceMediaInspection[] }> => ipcRenderer.invoke('select-source-media'),
  inspectSourceMedia: (paths: string[]): Promise<SourceMediaInspection[]> => ipcRenderer.invoke('inspect-source-media', paths),
  inspectArchiveSourceReferences: (paths: string[]): Promise<ArchiveSourceInspection[]> => ipcRenderer.invoke('inspect-archive-source-references', paths),
  selectArchiveRelocationCandidate: (): Promise<{ canceled: boolean; inspection?: ArchiveSourceInspection }> => ipcRenderer.invoke('select-archive-relocation-candidate'),
  registerSourceMedia: (mediaPath: string): Promise<{ url: string; path: string }> => ipcRenderer.invoke('register-source-media', mediaPath),
  generateSourceProxy: (sourceId: string, sourcePath: string): Promise<{ proxyPath: string; url: string; path: string }> => ipcRenderer.invoke('generate-source-proxy', sourceId, sourcePath),
  cancelSourceProxy: (sourceId: string): Promise<{ canceled: boolean }> => ipcRenderer.invoke('cancel-source-proxy', sourceId),
  generateSourceWaveform: (sourcePath: string): Promise<{ peaks: number[] }> => ipcRenderer.invoke('generate-source-waveform', sourcePath),
  generateSourceVisualCheckpoint: (sourcePath: string, start: number, end: number): Promise<SourceVisualCheckpointResult> => ipcRenderer.invoke('generate-source-visual-checkpoint', sourcePath, start, end),
  generateSourceVisualIndex: (sourcePath: string, maxFrames: number, interval: number): Promise<SourceVisualIndexResult> => ipcRenderer.invoke('generate-source-visual-index', sourcePath, maxFrames, interval),
  generateSourceVisualRefinement: (sourcePath: string, start: number, end: number, maxFrames: number): Promise<SourceVisualIndexResult> => ipcRenderer.invoke('generate-source-visual-refinement', sourcePath, start, end, maxFrames),
  getSourceVisualUnderstandingCapabilities: (): Promise<VisualUnderstandingCapabilities> => ipcRenderer.invoke('get-source-visual-understanding-capabilities'),
  probeSourceVisualUnderstandingProvider: (providerId: VisualUnderstandingProviderCapability['id']): Promise<VisualUnderstandingProviderProbe> => ipcRenderer.invoke('probe-source-visual-understanding-provider', providerId),
  analyzeSourceVisualFrames: (frames: VisualUnderstandingFrame[], providerId: VisualUnderstandingProviderCapability['id']): Promise<VisualUnderstandingResult> => ipcRenderer.invoke('analyze-source-visual-frames', frames, providerId),
  generateSourceStoryPreview: (request: SourceStoryPreviewRequest): Promise<SourceStoryPreviewResult & { url: string }> => ipcRenderer.invoke('generate-source-story-preview', request),
  cancelSourceStoryPreview: (jobId: string): Promise<{ canceled: boolean }> => ipcRenderer.invoke('cancel-source-story-preview', jobId),
  onSourceStoryPreviewProgress: (listener: (progress: SourceStoryPreviewProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: SourceStoryPreviewProgress) => listener(progress);
    ipcRenderer.on('source-story-preview-progress', handler);
    return () => ipcRenderer.removeListener('source-story-preview-progress', handler);
  },
  getSourceTranscriptionCapabilities: (): Promise<SourceTranscriptionCapabilities> => ipcRenderer.invoke('get-source-transcription-capabilities'),
  startSourceTranscription: (sourceId: string, sourcePath: string, options: { model: string; language: string }): Promise<{ jobId: string; cached: boolean; result?: SourceTranscriptionResult }> =>
    ipcRenderer.invoke('start-source-transcription', sourceId, sourcePath, options),
  cancelSourceTranscription: (jobId: string): Promise<{ canceled: boolean }> => ipcRenderer.invoke('cancel-source-transcription', jobId),
  onSourceProxyProgress: (listener: (progress: { sourceId: string; percent: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { sourceId: string; percent: number }) => listener(progress);
    ipcRenderer.on('source-proxy-progress', handler);
    return () => ipcRenderer.removeListener('source-proxy-progress', handler);
  },
  onSourceTranscriptionProgress: (listener: (progress: SourceTranscriptionProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: SourceTranscriptionProgress) => listener(progress);
    ipcRenderer.on('source-transcription-progress', handler);
    return () => ipcRenderer.removeListener('source-transcription-progress', handler);
  },
  onSourceTranscriptionResult: (listener: (result: SourceTranscriptionResult) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: SourceTranscriptionResult) => listener(result);
    ipcRenderer.on('source-transcription-result', handler);
    return () => ipcRenderer.removeListener('source-transcription-result', handler);
  },
  onSourceTranscriptionError: (listener: (failure: SourceTranscriptionFailure) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, failure: SourceTranscriptionFailure) => listener(failure);
    ipcRenderer.on('source-transcription-error', handler);
    return () => ipcRenderer.removeListener('source-transcription-error', handler);
  },
  exportDeliveryPackage: (payload: DeliveryPackagePayload): Promise<{ canceled: boolean; outputPath?: string }> =>
    ipcRenderer.invoke('export-delivery-package', payload),
  exportWinningStoryHandoff: (payload: WinningStoryHandoffPayload): Promise<{ canceled: boolean; outputPath?: string; fileCount?: number; sourceCount?: number }> =>
    ipcRenderer.invoke('export-winning-story-handoff', payload),
  revealPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('reveal-path', targetPath),
  startReleaseRender: (request: ReleaseRenderRequest): Promise<{ canceled: boolean; jobId?: string; outputPath?: string }> =>
    ipcRenderer.invoke('start-release-render', request),
  cancelReleaseRender: (jobId: string): Promise<{ canceled: boolean }> => ipcRenderer.invoke('cancel-release-render', jobId),
  getReleaseRenderStatus: (): Promise<ReleaseRenderStatusSnapshot> => ipcRenderer.invoke('get-release-render-status'),
  onReleaseRenderProgress: (listener: (progress: ReleaseRenderProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ReleaseRenderProgress) => listener(progress);
    ipcRenderer.on('release-render-progress', handler);
    return () => ipcRenderer.removeListener('release-render-progress', handler);
  },
  onReleaseRenderResult: (listener: (result: ReleaseRenderResult) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: ReleaseRenderResult) => listener(result);
    ipcRenderer.on('release-render-result', handler);
    return () => ipcRenderer.removeListener('release-render-result', handler);
  },
});
