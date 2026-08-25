import { useState } from 'react';
import type { Block, ChartProps, CursorProps, TextProps, VideoProps } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { fileToAsset, pickFile } from '@/lib/assets';
import { NumberField, Row } from '@/components/ui/Field';

/* ---------------- 共享选项 ---------------- */

export const ALIGN_OPTIONS: { value: TextProps['align']; label: string }[] = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
];

export const WEIGHT_OPTIONS_3 = [
  { value: '400', label: '常规' },
  { value: '500', label: '中等' },
  { value: '700', label: '粗' },
];

export const WEIGHT_OPTIONS_4 = [
  { value: '400', label: '常规' },
  { value: '500', label: '中等' },
  { value: '700', label: '粗' },
  { value: '900', label: '特粗' },
];

export const FIT_OPTIONS: { value: VideoProps['objectFit']; label: string }[] = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
];

export const CHART_TYPE_OPTIONS: { value: ChartProps['type']; label: string }[] = [
  { value: 'bar', label: '柱状' },
  { value: 'line', label: '折线' },
  { value: 'area', label: '面积' },
  { value: 'donut', label: '环形' },
  { value: 'progress', label: '进度' },
];

export const CURSOR_ACTION_OPTIONS: { value: CursorProps['action']; label: string }[] = [
  { value: 'move', label: '移动' },
  { value: 'click', label: '点击' },
  { value: 'double-click', label: '双击' },
  { value: 'drag', label: '拖拽' },
];

/* ---------------- 共享小组件 ---------------- */

/** 宽 × 高 成对输入 */
export function SizeRow({
  label = '尺寸',
  width,
  height,
  onChange,
  min = 1,
}: {
  label?: string;
  width: number;
  height: number;
  onChange: (patch: { width?: number; height?: number }) => void;
  min?: number;
}) {
  return (
    <Row label={label}>
      <div className="flex gap-2">
        <NumberField value={width} onChange={(width) => onChange({ width })} min={min} suffix="W" />
        <NumberField value={height} onChange={(height) => onChange({ height })} min={min} suffix="H" />
      </div>
    </Row>
  );
}

/** 单行文本输入（chart 标题 / card 眉题 / voice 发音人等） */
export function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-stroke bg-panel-3 px-2 py-[6px] text-[12px] text-ink outline-none focus:border-accent"
    />
  );
}

/** 替换 / 上传媒体素材（image 与 video 共用） */
export function useReplaceMedia(block: Extract<Block, { type: 'image' | 'video' }>) {
  const [uploading, setUploading] = useState(false);
  const addAsset = useEditorStore((s) => s.addAsset);
  const updateProps = useEditorStore((s) => s.updateProps);
  const updateBlock = useEditorStore((s) => s.updateBlock);
  const canvas = useEditorStore((s) => s.canvas);

  const replaceMedia = async () => {
    const accept = block.type === 'video' ? 'video/mp4,video/*' : 'image/*';
    setUploading(true);
    try {
      const file = await pickFile(accept);
      if (!file) return;
      const asset = await fileToAsset(file);
      if (!asset) return;
      addAsset(asset);
      const maxW = canvas.width * 0.6;
      const maxH = canvas.height * 0.6;
      const k = Math.min(1, maxW / asset.width, maxH / asset.height);
      updateProps(block.id, {
        assetId: asset.id,
        src: asset.url,
        width: Math.round(asset.width * k),
        height: Math.round(asset.height * k),
      });
      updateBlock(block.id, { name: asset.name.replace(/\.[^.]+$/, '') });
      if (block.type === 'video' && asset.duration) {
        updateBlock(block.id, { duration: asset.duration });
      }
    } finally {
      setUploading(false);
    }
  };

  return { uploading, replaceMedia };
}

/** 上传按钮（image 与 video 共用样式） */
export function MediaUploadButton({
  kind,
  uploading,
  hasSrc,
  onClick,
}: {
  kind: 'image' | 'video';
  uploading: boolean;
  hasSrc: boolean;
  onClick: () => void;
}) {
  const label = uploading
    ? '选择中…'
    : hasSrc
      ? kind === 'video' ? '替换视频' : '替换图片'
      : kind === 'video' ? '上传 MP4' : '上传图片';
  return (
    <button
      onClick={onClick}
      disabled={uploading}
      className={`w-full rounded-md border border-dashed border-stroke bg-panel-3 py-2 text-[11.5px] text-ink-dim hover:text-ink disabled:opacity-50 ${
        kind === 'video' ? 'hover:border-video' : 'hover:border-image'
      }`}
    >
      {label}
    </button>
  );
}
