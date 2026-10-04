import type { Block, ProjectSnapshot, SourceEventMarker, SourceRoughCutPlan, SourceTranscriptSegment, SourceTranscriptionMeta } from '@/types';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';

export type MediaKind = 'image' | 'video' | 'audio' | 'other';

export interface ManifestAsset {
  id: string;
  type: MediaKind;
  path: string;
  duration?: number;
}

export interface ManifestBlock {
  id: string;
  type: string;
  name: string;
  startTime: number;
  duration: number;
  layer: number;
  sceneId?: string;
  position: { x: number; y: number };
  animation: Block['animation'];
  props: Record<string, unknown>;
}

export interface DeliveryManifest {
  projectId: string;
  title: string;
  fps: number;
  resolution: [number, number];
  duration: number;
  colorGradePreset: string;
  format: 'mp4';
  blocks: ManifestBlock[];
  assets: ManifestAsset[];
  director?: ProjectSnapshot['director'];
  reviews?: ProjectSnapshot['reviews'];
  storyAssembly?: ProjectSnapshot['storyAssembly'];
  storyAssemblyVersions?: ProjectSnapshot['storyAssemblyVersions'];
  storyVersionSelection?: ProjectSnapshot['storyVersionSelection'];
  release?: DeliveryReleaseTrace;
}

export interface DeliveryReleaseTrace {
  candidateId: string;
  candidateVersion: number;
  candidateLabel: string;
  candidateCreatedAt: string;
  snapshotUpdatedAt: string;
  health: ReleaseCandidate['health'];
  reviewSummary: { approved: number; pending: number; changes: number; redo: number; unresolvedComments: number };
  finalRender?: { file: string; report: string; sha256: string; renderedAt?: string };
  storyDecision?: ReleaseCandidate['storyDecision'];
}

export interface DeliveryRenderArtifact {
  outputPath: string;
  reportPath: string;
  sha256: string;
  renderedAt?: string;
}

export interface DeliveryPackagePayload {
  projectId: string;
  folderName: string;
  manifest: DeliveryManifest;
  sceneplan: {
    projectId: string;
    version: number;
    scenes: ProjectSnapshot['scenes'];
    director?: ProjectSnapshot['director'];
    reviews?: ProjectSnapshot['reviews'];
    storyAssembly?: ProjectSnapshot['storyAssembly'];
    storyAssemblyVersions?: ProjectSnapshot['storyAssemblyVersions'];
    storyVersionSelection?: ProjectSnapshot['storyVersionSelection'];
    release?: DeliveryReleaseTrace;
    blocks: Array<Pick<ManifestBlock, 'id' | 'type' | 'name' | 'startTime' | 'duration' | 'sceneId'> & {
      assetId?: string;
    }>;
  };
  files: Array<{ relativePath: string; dataUrl: string }>;
  externalFiles: Array<{ relativePath: string; sourcePath: string }>;
  sourceIndex: Array<{
    id: string;
    name: string;
    duration: number;
    mediaPath: string;
    waveform?: { peaks: number[]; generatedAt: string };
    transcript?: SourceTranscriptSegment[];
    transcription?: SourceTranscriptionMeta;
    eventMarkers?: SourceEventMarker[];
    roughCutPlan?: SourceRoughCutPlan;
  }>;
  release?: DeliveryReleaseTrace;
}

export interface DeliveryPackageOptions {
  release?: Omit<DeliveryReleaseTrace, 'reviewSummary' | 'finalRender'>;
  renderArtifact?: DeliveryRenderArtifact;
}

const folderByKind: Record<MediaKind, string> = {
  image: 'images',
  video: 'videos',
  audio: 'audio',
  other: 'overlays',
};

const extensionByMime: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
};

function safeName(value: string, fallback: string) {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-');
  return cleaned.replace(/^\.+|\.+$/g, '').slice(0, 80) || fallback;
}

function extensionFor(dataUrl: string, originalName = '') {
  const mime = /^data:([^;,]+)/i.exec(dataUrl)?.[1]?.toLowerCase();
  if (mime && extensionByMime[mime]) return extensionByMime[mime];
  const match = /\.[a-z0-9]{2,5}$/i.exec(originalName);
  return match?.[0].toLowerCase() ?? '.bin';
}

function serializableProps(block: Block): Record<string, unknown> {
  const props = { ...block.props } as Record<string, unknown>;
  delete props.src;
  return props;
}

function fileNameFromPath(path: string, fallback: string) {
  const name = path.split(/[\\/]/).pop() || fallback;
  return safeName(name.replace(/\.[^.]+$/, ''), fallback) + (/\.[a-z0-9]{2,8}$/i.exec(name)?.[0].toLowerCase() ?? '');
}

function reviewSummary(snapshot: ProjectSnapshot): DeliveryReleaseTrace['reviewSummary'] {
  const summary = { approved: 0, pending: 0, changes: 0, redo: 0, unresolvedComments: 0 };
  for (const scene of snapshot.scenes) {
    const review = snapshot.reviews?.[scene.id];
    const status = review?.status ?? 'pending';
    summary[status] += 1;
    summary.unresolvedComments += review?.comments.filter((comment) => !comment.resolved).length ?? 0;
  }
  return summary;
}

/** 把编辑器快照转换成可交给 Electron 落盘的纯数据包。 */
export function createDeliveryPackage(snapshot: ProjectSnapshot, options: DeliveryPackageOptions = {}): DeliveryPackagePayload {
  const projectId = `hyperframes-${Date.now().toString(36)}`;
  const files: DeliveryPackagePayload['files'] = [];
  const externalFiles: DeliveryPackagePayload['externalFiles'] = [];
  const assets: ManifestAsset[] = [];
  const seenAssetIds = new Set<string>();

  const addMedia = (
    id: string,
    kind: MediaKind,
    dataUrl: string | null | undefined,
    name: string,
    duration?: number,
  ) => {
    if (!dataUrl || seenAssetIds.has(id)) return;
    const relativePath = `${folderByKind[kind]}/${safeName(id, 'asset')}${extensionFor(dataUrl, name)}`;
    files.push({ relativePath, dataUrl });
    assets.push({ id, type: kind, path: relativePath, ...(duration ? { duration } : {}) });
    seenAssetIds.add(id);
  };

  for (const asset of snapshot.assets) {
    addMedia(asset.id, asset.kind, asset.url, asset.name, asset.duration);
  }
  if (snapshot.narration) {
    addMedia(snapshot.narration.id, 'audio', snapshot.narration.src, snapshot.narration.name, snapshot.narration.duration);
  }
  for (const block of snapshot.blocks) {
    if (block.type === 'voice' && block.props.src) {
      addMedia(`voice-${block.id}`, 'audio', block.props.src, `${block.name}.mp3`, block.props.duration || block.duration);
    }
  }
  for (const source of snapshot.sourceMedia ?? []) {
    if (seenAssetIds.has(source.id)) continue;
    const extension = /\.[a-z0-9]{2,5}$/i.exec(source.name)?.[0] ?? '.mp4';
    const relativePath = `videos/${safeName(source.id, 'source')}${extension.toLowerCase()}`;
    externalFiles.push({ relativePath, sourcePath: source.path });
    assets.push({ id: source.id, type: 'video', path: relativePath, duration: source.duration });
    seenAssetIds.add(source.id);
  }
  let release: DeliveryReleaseTrace | undefined;
  if (options.release) {
    const render = options.renderArtifact;
    const finalVideo = render ? `final/${fileNameFromPath(render.outputPath, 'final.mp4')}` : '';
    const finalReport = render ? `reports/${fileNameFromPath(render.reportPath, 'render-report.json')}` : '';
    if (render) {
      externalFiles.push({ relativePath: finalVideo, sourcePath: render.outputPath });
      externalFiles.push({ relativePath: finalReport, sourcePath: render.reportPath });
    }
    release = {
      ...options.release,
      reviewSummary: reviewSummary(snapshot),
      ...(render ? { finalRender: { file: finalVideo, report: finalReport, sha256: render.sha256, ...(render.renderedAt ? { renderedAt: render.renderedAt } : {}) } } : {}),
    };
  }

  const blocks: ManifestBlock[] = snapshot.blocks.map((block) => {
    const props = serializableProps(block);
    if (block.type === 'voice' && block.props.src) props.assetId = `voice-${block.id}`;
    if (block.type === 'video' && block.props.externalSourceId) props.assetId = block.props.externalSourceId;
    return {
      id: block.id,
      type: block.type,
      name: block.name,
      startTime: block.start,
      duration: block.duration,
      layer: block.layer,
      ...(block.sceneId ? { sceneId: block.sceneId } : {}),
      position: block.position,
      animation: block.animation,
      props,
    };
  });
  const duration = blocks.reduce((max, block) => Math.max(max, block.startTime + block.duration), 0);
  const manifest: DeliveryManifest = {
    projectId,
    title: snapshot.projectName,
    fps: snapshot.canvas.fps,
    resolution: [snapshot.canvas.width, snapshot.canvas.height],
    duration,
    colorGradePreset: 'neutral',
    format: 'mp4',
    blocks,
    assets,
    director: snapshot.director,
    reviews: snapshot.reviews,
    storyAssembly: snapshot.storyAssembly,
    storyAssemblyVersions: snapshot.storyAssemblyVersions,
    storyVersionSelection: snapshot.storyVersionSelection,
    release,
  };

  return {
    projectId,
    folderName: `${safeName(snapshot.projectName, 'hyperframes-video')}-delivery`,
    manifest,
    sceneplan: {
      projectId,
      version: 1,
      scenes: snapshot.scenes,
      director: snapshot.director,
      reviews: snapshot.reviews,
      storyAssembly: snapshot.storyAssembly,
      storyAssemblyVersions: snapshot.storyAssemblyVersions,
      storyVersionSelection: snapshot.storyVersionSelection,
      release,
      blocks: blocks.map((block) => ({
        id: block.id,
        type: block.type,
        name: block.name,
        startTime: block.startTime,
        duration: block.duration,
        ...(block.sceneId ? { sceneId: block.sceneId } : {}),
        ...(typeof block.props.assetId === 'string' ? { assetId: block.props.assetId } : {}),
      })),
    },
    files,
    externalFiles,
    sourceIndex: (snapshot.sourceMedia ?? []).map((source) => ({
      id: source.id,
      name: source.name,
      duration: source.duration,
      mediaPath: assets.find((asset) => asset.id === source.id)?.path ?? '',
      ...(source.waveform ? { waveform: source.waveform } : {}),
      ...(source.transcript ? { transcript: source.transcript } : {}),
      ...(source.transcription ? { transcription: source.transcription } : {}),
      ...(source.eventMarkers?.length ? { eventMarkers: source.eventMarkers } : {}),
      ...(source.roughCutPlan ? { roughCutPlan: source.roughCutPlan } : {}),
    })),
    release,
  };
}

export function createReleaseDeliveryPackage(candidate: ReleaseCandidate, renderArtifact?: DeliveryRenderArtifact) {
  const artifact = renderArtifact ?? candidate.render;
  return createDeliveryPackage(candidate.snapshot, {
    release: {
      candidateId: candidate.id,
      candidateVersion: candidate.version,
      candidateLabel: candidate.label,
      candidateCreatedAt: candidate.createdAt,
      snapshotUpdatedAt: candidate.snapshot.updatedAt,
      health: candidate.health,
      storyDecision: candidate.storyDecision,
    },
    renderArtifact: artifact,
  });
}
