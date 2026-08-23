import { useState } from 'react';
import type { BlockType } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { fileToAsset, formatBytes, pickFile, pickFiles } from '@/lib/assets';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import LayersPanel from '@/components/sidebar/LayersPanel';

interface LibItem {
  type: BlockType;
  title: string;
  desc: string;
  accept?: string;
  icon: JSX.Element;
}

const ITEMS: LibItem[] = [
  {
    type: 'image',
    title: 'Image 图片积木',
    desc: '上传图片 · 位置 / 缩放 / 透明度',
    accept: 'image/*',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <circle cx="8.5" cy="8.5" r="1.6" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    ),
  },
  {
    type: 'text',
    title: 'Text 文字积木',
    desc: '字号 / 颜色 / 位置 · fade slide scale',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 6V4h16v2M12 4v16M9 20h6" />
      </svg>
    ),
  },
  {
    type: 'video',
    title: 'Video 视频积木',
    desc: '上传 MP4 · 背景播放 / 循环 / 透明度',
    accept: 'video/mp4,video/*',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2" y="4.5" width="14" height="15" rx="2.5" />
        <path d="m22 7.5-6 4.5 6 4.5v-9Z" />
      </svg>
    ),
  },
  {
    type: 'spotlight',
    title: 'Spotlight 聚光积木',
    desc: '压暗画面 · 聚光亮洞引导视线',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
      </svg>
    ),
  },
  {
    type: 'glassui',
    title: 'GlassUI 玻璃积木',
    desc: '毛玻璃卡片 · 模糊 / 圆角 / 描边',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3.5" y="5" width="17" height="14" rx="3.5" />
        <path d="M8 9.5h8M8 13h5" />
      </svg>
    ),
  },
  {
    type: 'cursor',
    title: 'Cursor 鼠标教学',
    desc: '移动 / 点击 / 双击 / 拖拽提示',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="m5 3 14 12-6 .5 3 5-3 1.5-3-5-5 4V3Z" />
      </svg>
    ),
  },
  {
    type: 'card',
    title: 'Card 信息卡片',
    desc: '标题 / 正文 / 强调色 · 内容分层',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M7 9h3M7 13h10M7 16h7" />
      </svg>
    ),
  },
  {
    type: 'chart',
    title: 'Chart 图表积木',
    desc: '柱状 / 折线 / 面积 / 环形 / 进度',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 20V10M9 20V4M14 20v-7M19 20v-11" />
      </svg>
    ),
  },
  {
    type: 'scrollstory',
    title: 'ScrollStory 滚动积木',
    desc: '文字随进度上滚 · 故事化字幕',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    type: 'subtitle',
    title: 'Subtitle 字幕积木',
    desc: '底部字幕条 · 半透明底衬',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="14" width="18" height="6" rx="2" />
        <path d="M7 17h10" />
      </svg>
    ),
  },
  {
    type: 'voice',
    title: 'Voice AI配音',
    desc: '配音文案 / 音色 / 语速 · 音频占位',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="8" width="4" height="8" rx="2" />
        <path d="M7 12h3m0-4v8m0-5h3m0-3v8m0-5h3m0-2v4m0-1h3" />
      </svg>
    ),
  },
];

export default function BlockLibrary() {
  const [busy, setBusy] = useState<BlockType | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const assets = useEditorStore((s) => s.assets);
  const addAsset = useEditorStore((s) => s.addAsset);
  const addBlock = useEditorStore((s) => s.addBlock);
  const addBlockFromAsset = useEditorStore((s) => s.addBlockFromAsset);
  const bindAssetToSelectedImage = useEditorStore((s) => s.bindAssetToSelectedImage);
  const blocks = useEditorStore((s) => s.blocks);
  const autoMatchAssets = useEditorStore((s) => s.autoMatchAssets);

  const handleAdd = async (item: LibItem) => {
    if (!item.accept) {
      addBlock(item.type);
      return;
    }
    setBusy(item.type);
    try {
      const file = await pickFile(item.accept);
      if (!file) {
        // 没选文件也放个占位积木，之后可在右侧补上传
        addBlock(item.type);
        return;
      }
      const asset = await fileToAsset(file);
      if (!asset) {
        addBlock(item.type);
        return;
      }
      addAsset(asset);
      addBlockFromAsset(asset);
    } finally {
      setBusy(null);
    }
  };

  const handleBatchImport = async () => {
    const files = await pickFiles('image/*,video/*');
    if (!files.length) return;
    setBatchBusy(true);
    let count = 0;
    try {
      for (const file of files) {
        const asset = await fileToAsset(file);
        if (asset) { addAsset(asset); count += 1; }
      }
      alert(`已导入 ${count} 个素材。现在可以点击“自动匹配到字幕”。`);
    } finally { setBatchBusy(false); }
  };

  const handleAutoMatch = () => {
    try {
      const result = autoMatchAssets();
      alert(`已自动匹配 ${result.matched} 个场景。\n未匹配场景：${result.unmatchedScenes}\n未使用素材：${result.unusedAssets}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col overflow-y-auto border-r border-stroke bg-panel">
      {/* 积木库 */}
      <div className="border-b border-stroke px-3 py-3">
        <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
          Block Library
        </h2>
        <div className="space-y-2">
          {ITEMS.map((item) => (
            <button
              key={item.type}
              onClick={() => handleAdd(item)}
              disabled={busy !== null}
              className="group flex w-full items-center gap-3 rounded-lg border border-stroke bg-panel-2 p-2.5 text-left transition-all hover:-translate-y-[1px] hover:border-accent/60 hover:bg-panel-3 disabled:opacity-50"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                style={{
                  background: `${BLOCK_COLOR[item.type]}1f`,
                  color: BLOCK_COLOR[item.type],
                }}
              >
                <span className="h-[18px] w-[18px]">{item.icon}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {busy === item.type ? '选择文件…' : item.title}
                </span>
                <span className="block truncate text-[10.5px] text-ink-faint">{item.desc}</span>
              </span>
              <span className="ml-auto text-[15px] text-ink-faint group-hover:text-accent">+</span>
            </button>
          ))}
        </div>
      </div>

      {/* 素材库 */}
      <div className="border-b border-stroke px-3 py-3">
        <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
          Assets · {assets.length}
        </h2>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button onClick={handleBatchImport} disabled={batchBusy} className="rounded-md border border-stroke bg-panel-3 px-2 py-2 text-[10.5px] text-ink-dim hover:border-accent hover:text-ink disabled:opacity-50">
            {batchBusy ? '导入中…' : '批量导入素材'}
          </button>
          <button onClick={handleAutoMatch} className="rounded-md bg-accent px-2 py-2 text-[10.5px] font-medium text-white hover:brightness-110">
            自动匹配到字幕
          </button>
        </div>
        <p className="mb-2 px-1 text-[10px] leading-relaxed text-ink-faint">
          选中 ImageBlock 后点击图片，可“匹配到镜头”；未选中时会新增图片积木。
        </p>
        {assets.length === 0 ? (
          <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
            上传过的素材会留在这里，点一下即可复用。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {assets.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  const bound = bindAssetToSelectedImage(a);
                  if (!bound) addBlockFromAsset(a);
                }}
                title={`${a.name} · ${formatBytes(a.size)} · ${blocks.some((b) => b.type === 'image' && b.props.assetId === a.id) ? 'matched' : 'unmatched'}`}
                className="group relative aspect-square overflow-hidden rounded-md border border-stroke bg-black/40 hover:border-accent"
              >
                {a.kind === 'image' ? (
                  <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                ) : (
                  <video src={a.url} muted className="h-full w-full object-cover" />
                )}
                <span className="absolute bottom-0 left-0 right-0 truncate bg-black/70 px-1 py-[1px] text-[9px] text-ink-dim">
                  {a.kind === 'video' ? '▶ ' : ''}
                  {a.name}
                </span>
                <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[8px] text-white/70">
                  {blocks.some((b) => b.type === 'image' && b.props.assetId === a.id) ? 'matched' : 'unmatched'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 图层（多层级管理 + 拖拽排序 + 可见/锁定） */}
      <LayersPanel />
    </aside>
  );
}
