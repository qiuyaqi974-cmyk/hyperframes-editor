import fs from 'fs';
import path from 'path';

/** 模拟 editorStore 状态（实际从 zustand 获取） */
const editorStore = {
  projectName: 'DemoVideo',
  blocks: [
    {
      id: 'blk-001',
      type: 'text',
      duration: 5,
      props: { text: 'Hello HyperFrames', color: '#fff', fontSize: 48 },
    },
    {
      id: 'blk-002',
      type: 'image',
      duration: 8,
      props: { assetId: 'img-001' },
    },
    {
      id: 'blk-003',
      type: 'voice',
      duration: 12,
      props: { assetId: 'aud-001' },
    },
  ],
  assets: [
    {
      id: 'img-001',
      kind: 'image',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAfQJAJdr1wAAAABJRU5ErkJggg==',
      width: 1920,
      height: 1080,
      duration: undefined,
      size: 123,
    },
    {
      id: 'aud-001',
      kind: 'audio',
      url: 'data:audio/mpeg;base64,TXcgLgAAAAAAAAAAAAAAAAAAACUAAACBVU0BLZM+eAAAAABJRU5ErkJggg==',
      sampleRate: 24000,
      duration: 15,
      size: 456,
    },
  ],
  narrationTrack: {
    id: 'aud-001',
    name: 'narration',
    kind: 'audio',
    src: 'data:audio/mpeg;base64,TXcgLgAAAAAAAAAAAAAAAAAAACUAAACBVU0BLZM+eAAAAABJRU5ErkJggg==',
    duration: 15,
  },
};

/** kind -> folder name */
const kindFolder = { image: 'images', video: 'videos', audio: 'audio', other: 'overlays' };

/**
 * 将 data URL base64 写入文件，返回相对路径（相对于输出根目录）。
 */
function writeDataUrlFile(dataUrl, targetDir, subFolder, fileName) {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) throw new Error('Invalid data URL');
  const base64 = dataUrl.slice(commaIdx + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const outPath = path.join(targetDir, subFolder, fileName);
  return new Promise((resolve, reject) => {
    fs.writeFile(outPath, Buffer.from(bytes), (err) => {
      if (err) return reject(err);
      resolve(path.join(subFolder, fileName));
    });
  });
}

/** 主函数 */
(async () => {
  const outDir = path.join(process.cwd(), 'delivery-demo-' + Date.now());
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 创建子文件夹
  for (const k of Object.keys(kindFolder)) {
    fs.mkdirSync(path.join(outDir, kindFolder[k]), { recursive: true });
  }

  // 导出资产
  const manifestAssets = [];
  const assetIdToRel = new Map();

  for (const a of editorStore.assets) {
    const kind = a.kind;
    const folder = kindFolder[kind];
    // 根据 kind 猜测扩展名；如果 url 已有扩展名则使用它
    const extIdx = a.url.lastIndexOf('.');
    const ext = extIdx > 0 ? a.url.slice(extIdx) : (kind === 'image' ? '.png' : '.mp3');
    const fileName = `${a.id}${ext}`;
    try {
      const relPath = await writeDataUrlFile(a.url, outDir, folder, fileName);
      manifestAssets.push({
        id: a.id,
        type: kind,
        path: relPath,
        duration: a.duration,
        sampleRate: a.sampleRate ?? 24000,
      });
      assetIdToRel.set(a.id, relPath);
    } catch (e) {
      console.warn('Asset write error:', e);
    }
  }

  // 计算坨时间轴
  let cum = 0;
  const manifestBlocks = [];
  for (const b of editorStore.blocks) {
    const start = cum;
    const dur = b.duration ?? 0;
    cum += dur;
    const keyProps = {};
    if (b.type === 'text') {
      keyProps.text = b.props.text;
      keyProps.color = b.props.color;
      keyProps.fontSize = b.props.fontSize;
    }
    if (b.type === 'image') {
      keyProps.assetId = b.props.assetId;
    }
    if (b.type === 'voice') {
      keyProps.assetId = b.props.assetId;
    }
    manifestBlocks.push({
      id: b.id,
      type: b.type,
      startTime: start,
      duration: dur,
      props: keyProps,
    });
  }

  // 音轨相对路径
  let audioRel = null;
  if (editorStore.narrationTrack) {
    const t = editorStore.narrationTrack;
    const kind = t.kind;
    const folder = kindFolder[kind];
    const ext = t.src.lastIndexOf('.') > 0 ? t.src.slice(t.src.lastIndexOf('.')) : '.mp3';
    const fileName = `${t.id}${ext}`;
    try {
      const relPath = await writeDataUrlFile(t.src, outDir, folder, fileName);
      audioRel = `${folder}/${fileName}`;
      // 写入 manifestAssets (若尚无)
      const already = manifestAssets.find((x) => x.id === t.id);
      if (!already) {
        manifestAssets.push({
          id: t.id,
          type: kind,
          path: audioRel,
          duration: t.duration,
          sampleRate: t.sampleRate ?? 24000,
        });
      }
    } catch (e) {
      console.warn('Narration track error:', e);
    }
  }

  // 构造 manifest
  const manifest = {
    projectId: 'hyperframes-demo-001',
    title: editorStore.projectName,
    fps: 30,
    resolution: [1920, 1080],
    colorGradePreset: 'neutral',
    format: 'mp4',
    blocks: manifestBlocks,
    assets: manifestAssets,
  };

  // 构造 sceneplan
  const sceneplan = {
    projectId: 'hyperframes-demo-001',
    version: 1,
    blocks: manifestBlocks.map((b) => ({
      id: b.id,
      type: b.type,
      startTime: b.startTime,
      duration: b.duration,
      assetId: b.props.assetId,
    })),
  };

  // 写入 JSON
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outDir, 'sceneplan.json'), JSON.stringify(sceneplan, null, 2));

  console.log('✅ Delivery package exported to:', outDir);
  console.log('Folder contents:');
  console.log(fs.readdirSync(outDir).join('\n'));

  // 列出子文件夹
  for (const k of Object.keys(kindFolder)) {
    const d = path.join(outDir, kindFolder[k]);
    if (fs.existsSync(d)) {
      console.log(`\n${kindFolder[k]}/ :`, fs.readdirSync(d).join(', '));
    }
  }
})();