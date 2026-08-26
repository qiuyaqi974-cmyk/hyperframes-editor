/**
 * HyperFrames → video‑use / 其他 Agent 交付包
 *
 * 目标：导出一个项目文件夹，里面包含：
 *   manifest.json   — 包含时间轴 blocks、媒体引用（相对路径）以及全局元数据
 *   sceneplan.json — 与 manifest 等价的“剧本”记录（仅保留坨级信息）
 *   assets/         — 按类型拆分的真实媒体文件（images/, videos/, audio/, overlays/）
 *
 * 设计约束：
 *   - JSON 内不含 base64 / data URL，全部使用相对路径
 *   - 媒体文件按类型存放在 assets/<type>/ 下
 *   - 以后可直接将这个文件夹传给 video‑use 继续剪辑、配乐、字幕烧录
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 媒体类型与文件夹的映射 */
type MediaKind = 'image' | 'video' | 'audio' | 'other';
const kindFolder: Record<MediaKind, string> = {
  image: 'images',
  video: 'videos',
  audio: 'audio',
  other: 'overlays',
};

/** 单个媒体条目（manifest.json 的 assets[]） */
export interface ManifestAsset {
  id: string;
  type: MediaKind;
  path: string; // 相对于 manifest.json 的相对路径，如 "images/hero.png"
  duration?: number; // 仅对 audio/video 有效
  sampleRate?: number; // 仅对 audio 有效
}

/** 单个坨的时间定义（manifest.json / sceneplan.json 的 blocks[]） */
export interface ManifestBlock {
  id: string;
  type: string; // BlockType 字符串
  startTime: number; // 秒，相对于项目起点
  duration: number; // 秒
  props: Record<string, unknown>; // 仅保留 video‑use 关心的关键属性
}

/** manifest.json 的完整结构 */
export interface Manifest {
  projectId: string;
  title?: string;
  fps: number;
  resolution: [number, number];
  colorGradePreset?: string;
  format?: 'mp4' | 'mov' | 'webm';
  blocks: ManifestBlock[];
  assets: ManifestAsset[];
}

/** sceneplan.json 的精简结构（仅保留坨级信息，便于后续 ScenePlan → HyperFrames 映射） */
export interface ScenePlan {
  projectId: string;
  version: number;
  blocks: Array<{
    id: string;
    type: string;
    startTime: number;
    duration: number;
    assetId?: string; // 引用 assets[].id
    // 其它 prop 字段可根据需要保留
  }>;
}

/**
 * 将 data URL 的 base64 写入文件，返回相对于 outputDir 的相对路径。
 */
function writeDataUrlFile(
  dataUrl: string,
  targetDir: string,
  subFolder: string,
  fileName: string
): Promise<string> {
  // dataUrl 格式: "data:[<mediatype>][;base64],<data>"
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) throw new Error('Invalid data URL');
  const base64 = dataUrl.slice(commaIdx + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const outPath = `${targetDir}/${subFolder}/${fileName}`;
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    fs.writeFile(outPath, Buffer.from(bytes), (err) => {
      if (err) return reject(err);
      // 返回相对于 manifest.json 的路径（manifest 会以相对路径形式记录）
      resolve(`${subFolder}/${fileName}`);
    });
  });
}

/**
 * 辅助：从 asset url 判断媒体 kind
 */
function guessKindFromUrl(url: string): MediaKind {
  if (/^data:image\//i.test(url)) return 'image';
  if (/^data:video\//i.test(url)) return 'video';
  if (/^data:audio\//i.test(url)) return 'audio';
  return 'other';
}

/**
 * 核心导出函数
 *
 * @param options.projectName - 项目名称，用于生成 projectId 与标题
 * @options.editorStore - 包含以下字段（通过 getState 等获取）：
 *   - blocks: Block[] (按顺序排列)
 *   - assets: Asset[] (每项有 id, kind, url (data URL), width, height, duration?, size)
 *   - narrationTrack: NarrationTrack | null (id, name, src (data URL), duration)
 * @options.opts - 用户自定义：title, fps, resolution, colorGradePreset
 * @returns {Promise<string>} 输出文件夹的绝对路径
 */
export async function exportDeliveryPackage(
  {
    projectName,
    editorStore,
    opts = {},
  }: {
    projectName: string;
    editorStore: {
      blocks: any[];
      assets: any[];
      narrationTrack?: any;
    };
    opts?: {
      title?: string;
      fps?: number;
      resolution?: [number, number];
      colorGradePreset?: string;
    };
  },
  outputDir?: string
): Promise<string> {
  // -----------------------------------------------------------------------
  // 1. 基本设置
  // -----------------------------------------------------------------------
  const fs = require('fs');
  const path = require('path');

  const title = opts.title ?? projectName;
  const fps = opts.fps ?? 30;
  const resolution: [number, number] = opts.resolution ?? [1920, 1080];
  const colorGradePreset = opts.colorGradePreset ?? 'neutral';

  // 生成 projectId（简单 uuid，实际可用 crypto.randomUUID）
  const projectId = 'hyperframes-' + Math.random().toString(36).slice(2, 12);

  // 确定输出目录
  const out = outputDir ?? path.join(process.cwd(), 'delivery-' + projectId);
  if (fs.existsSync(out)) fs.rmSync(out, { recursive: true });
  fs.mkdirSync(out, { recursive: true });

  // 创建子文件夹
  const subfolders: string[] = [];
  for (const kind of Object.values(MediaKind)) {
    const dir = path.join(out, kindFolder[kind]);
    fs.mkdirSync(dir, { recursive: true });
    subfolders.push(dir);
  }

  // -----------------------------------------------------------------------
  // 2. 映射资产：写入实体文件，记录相对路径
  // -----------------------------------------------------------------------
  const manifestAssets: ManifestAsset[] = [];
  const assetIdToRelativePath = new Map<string, string>();

  for (const asset of editorStore.assets) {
    const kind = guessKindFromUrl(asset.url);
    const folder = kindFolder[kind];
    // 生成文件名：保持原扩展名或默认
    const extIdx = asset.url.lastIndexOf('.');
    const ext = extIdx > 0 ? asset.url.slice(extIdx) : (kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : '.mp3');
    const fileName = `${asset.id}${ext}`;
    try {
      const relPath = await writeDataUrlFile(asset.url, out, folder, fileName);
      manifestAssets.push({
        id: asset.id,
        type: kind,
        path: relPath,
        duration: asset.duration,
        sampleRate: 24000, // TTS 服务器常用采样率，可从元数据里获取
      });
      assetIdToRelativePath.set(asset.id, relPath);
    } catch (e) {
      console.warn(`Failed to export asset ${asset.id}:`, e);
    }
  }

  // -----------------------------------------------------------------------
  // 3. 计算坨的起止时间
  // -----------------------------------------------------------------------
  let cumulative = 0;
  const manifestBlocks: ManifestBlock[] = [];
  for (const block of editorStore.blocks) {
    const startTime = cumulative;
    const duration = typeof block.duration === 'number' ? block.duration : 0;
    cumulative += duration;

    // 只保留 video‑use 关心的关键 props：assetId、文字内容、颜色等
    const keyProps: Record<string, unknown> = {};
    // 示例：若是文字坨，保留 content、color、fontSize
    if (block.type === 'text') {
      keyProps['text'] = (block as any).props?.text;
      keyProps['color'] = (block as any).props?.color;
      keyProps['fontSize'] = (block as any).props?.fontSize;
    }
    // 若是图片坨，保留 assetId 引用
    if (block.type === 'image') {
      keyProps['assetId'] = (block as any).props?.assetId;
    }
    // 其它类型可根据需要继续扩展

    manifestBlocks.push({
      id: block.id,
      type: block.type,
      startTime,
      duration,
      props: keyProps,
    });
  }

  // -----------------------------------------------------------------------
  // 4. 音轨
  // -----------------------------------------------------------------------
  let audioRelPath: string | undefined = undefined;
  if (editorStore.narrationTrack) {
    const track = editorStore.narrationTrack;
    const kind = guessKindFromUrl(track.src);
    const folder = kindFolder[kind];
    const extIdx = track.src.lastIndexOf('.');
    const ext = extIdx > 0 ? track.src.slice(extIdx) : '.mp3';
    const fileName = `${track.id}${ext}`;
    try {
      const relPath = await writeDataUrlFile(track.src, out, folder, fileName);
      audioRelPath = `${folder}/${fileName}`;
      // 确保 manifestAssets 里也有对应 entry（若尚无）
      const existing = manifestAssets.find((a) => a.id === track.id);
      if (!existing) {
        manifestAssets.push({
          id: track.id,
          type: kind,
          path: audioRelPath,
          duration: track.duration,
          sampleRate: 24000,
        });
      }
    } catch (e) {
      console.warn('Failed to export narration track:', e);
    }
  }

  // -----------------------------------------------------------------------
  // 5. 写入 manifest.json 与 sceneplan.json
  // -----------------------------------------------------------------------
  const manifest: Manifest = {
    projectId,
    title,
    fps,
    resolution,
    colorGradePreset,
    format: 'mp4',
    blocks: manifestBlocks,
    assets: manifestAssets,
  };

  const sceneplan: ScenePlan = {
    projectId,
    version: 1,
    blocks: manifestBlocks.map((b) => ({
      id: b.id,
      type: b.type,
      startTime: b.startTime,
      duration: b.duration,
      assetId: b.props.assetId,
    })),
  };

  fs.writeFileSync(
    path.join(out, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  fs.writeFileSync(
    path.join(out, 'sceneplan.json'),
    JSON.stringify(sceneplan, null, 2)
  );

  console.log(`✅ Delivery package exported to: ${out}`);
  return out;
}

export default exportDeliveryPackage;