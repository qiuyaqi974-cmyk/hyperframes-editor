import { useState } from 'react';
import type {
  AnimationType,
  Block,
  ChartProps,
  CursorProps,
  EasingName,
  SlideDirection,
  TextProps,
  VideoProps,
} from '@/types';
import { useEditorStore, useSelectedBlock } from '@/store/editorStore';
import { fileToAsset, pickFile } from '@/lib/assets';
import { EASINGS } from '@/lib/animation';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import {
  ColorField,
  NumberField,
  Row,
  Section,
  Segmented,
  SliderField,
  TextArea,
  Toggle,
} from '@/components/ui/Field';

const TYPE_LABEL: Record<Block['type'], string> = {
  image: 'ImageBlock',
  text: 'TextBlock',
  video: 'VideoBlock',
  spotlight: 'SpotlightBlock',
  glassui: 'GlassUIBlock',
  card: 'CardBlock',
  cursor: 'CursorBlock',
  chart: 'ChartBlock',
  scrollstory: 'ScrollStoryBlock',
  subtitle: 'SubtitleBlock',
  voice: 'VoiceBlock',
};

const ANIM_OPTIONS: { value: AnimationType; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'scale', label: 'Scale' },
];

const EASE_OPTIONS: { value: EasingName; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeOut', label: 'Out' },
  { value: 'easeInOut', label: 'InOut' },
  { value: 'spring', label: 'Spring' },
];

const DIR_OPTIONS: { value: SlideDirection; label: string }[] = [
  { value: 'left', label: '← 左' },
  { value: 'right', label: '右 →' },
  { value: 'up', label: '↑ 上' },
  { value: 'down', label: '↓ 下' },
];

const ALIGN_OPTIONS: { value: TextProps['align']; label: string }[] = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
];

const FIT_OPTIONS: { value: VideoProps['objectFit']; label: string }[] = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
];

const CHART_TYPE_OPTIONS: { value: ChartProps['type']; label: string }[] = [
  { value: 'bar', label: '柱状' },
  { value: 'line', label: '折线' },
  { value: 'area', label: '面积' },
  { value: 'donut', label: '环形' },
  { value: 'progress', label: '进度' },
];

const CURSOR_ACTION_OPTIONS: { value: CursorProps['action']; label: string }[] = [
  { value: 'move', label: '移动' },
  { value: 'click', label: '点击' },
  { value: 'double-click', label: '双击' },
  { value: 'drag', label: '拖拽' },
];

export default function PropertyPanel() {
  const block = useSelectedBlock();
  const [uploading, setUploading] = useState(false);

  const updateBlock = useEditorStore((s) => s.updateBlock);
  const updateProps = useEditorStore((s) => s.updateProps);
  const updateAnimation = useEditorStore((s) => s.updateAnimation);
  const removeBlock = useEditorStore((s) => s.removeBlock);
  const duplicateBlock = useEditorStore((s) => s.duplicateBlock);
  const reorderLayer = useEditorStore((s) => s.reorderLayer);
  const addAsset = useEditorStore((s) => s.addAsset);
  const setTime = useEditorStore((s) => s.setTime);
  const canvas = useEditorStore((s) => s.canvas);

  if (!block) {
    return (
      <aside className="flex w-[288px] shrink-0 flex-col border-l border-stroke bg-panel">
        <PanelHeader title="Inspector" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[12px] text-ink-dim">未选中积木</p>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            点击画布里的元素，或左侧图层列表，即可编辑参数
          </p>
        </div>
      </aside>
    );
  }

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

  const anim = block.animation;

  return (
    <aside className="flex w-[288px] shrink-0 flex-col overflow-hidden border-l border-stroke bg-panel">
      <PanelHeader title="Inspector" />

      {/* 头部：类型 + 名称 */}
      <div className="flex items-center gap-2 border-b border-stroke px-4 py-3">
        <span
          className="h-[10px] w-[10px] shrink-0 rounded-sm"
          style={{ background: BLOCK_COLOR[block.type] }}
        />
        <input
          value={block.name}
          onChange={(e) => updateBlock(block.id, { name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none"
        />
        <span
          className="shrink-0 rounded px-1.5 py-[2px] font-mono text-[9.5px]"
          style={{ background: `${BLOCK_COLOR[block.type]}1f`, color: BLOCK_COLOR[block.type] }}
        >
          {TYPE_LABEL[block.type]}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ---------------- Transform ---------------- */}
        <Section title="Transform">
          <Row label="位置">
            <div className="flex gap-2">
              <NumberField
                value={block.position.x}
                onChange={(x) => updateBlock(block.id, { position: { ...block.position, x } })}
                suffix="X"
              />
              <NumberField
                value={block.position.y}
                onChange={(y) => updateBlock(block.id, { position: { ...block.position, y } })}
                suffix="Y"
              />
            </div>
          </Row>

          {block.type !== 'text' && block.type !== 'subtitle' && (
            <Row label="缩放">
              <SliderField
                value={(block.props as { scale: number }).scale}
                onChange={(scale) => updateProps(block.id, { scale })}
                min={0.05}
                max={3}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </Row>
          )}

          <Row label="透明度">
            <SliderField
              value={(block.props as { opacity: number }).opacity}
              onChange={(opacity) => updateProps(block.id, { opacity })}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </Row>

          <Row label="层级">
            <div className="flex items-center gap-2">
              <button
                onClick={() => reorderLayer(block.id, 1)}
                className="flex-1 rounded-md border border-stroke bg-panel-3 py-[5px] text-[11px] text-ink-dim hover:border-accent hover:text-ink"
              >
                上移
              </button>
              <button
                onClick={() => reorderLayer(block.id, -1)}
                className="flex-1 rounded-md border border-stroke bg-panel-3 py-[5px] text-[11px] text-ink-dim hover:border-accent hover:text-ink"
              >
                下移
              </button>
              <span className="w-[26px] text-center font-mono text-[11px] text-ink-faint">
                {block.layer}
              </span>
            </div>
          </Row>
        </Section>

        {/* ---------------- 按类型的专属参数 ---------------- */}
        {block.type === 'image' && (
          <Section title="Image" accent={BLOCK_COLOR.image}>
            <button
              onClick={replaceMedia}
              disabled={uploading}
              className="w-full rounded-md border border-dashed border-stroke bg-panel-3 py-2 text-[11.5px] text-ink-dim hover:border-image hover:text-ink disabled:opacity-50"
            >
              {uploading ? '选择中…' : block.props.src ? '替换图片' : '上传图片'}
            </button>
            <Row label="尺寸">
              <div className="flex gap-2">
                <NumberField
                  value={block.props.width}
                  onChange={(width) => updateProps(block.id, { width })}
                  min={1}
                  suffix="W"
                />
                <NumberField
                  value={block.props.height}
                  onChange={(height) => updateProps(block.id, { height })}
                  min={1}
                  suffix="H"
                />
              </div>
            </Row>
            <Row label="旋转">
              <SliderField
                value={block.props.rotation}
                onChange={(rotation) => updateProps(block.id, { rotation })}
                min={-180}
                max={180}
                step={1}
                format={(v) => `${Math.round(v)}°`}
              />
            </Row>
            <Row label="圆角">
              <SliderField
                value={block.props.radius}
                onChange={(radius) => updateProps(block.id, { radius })}
                min={0}
                max={200}
                step={1}
                format={(v) => `${Math.round(v)}`}
              />
            </Row>
          </Section>
        )}

        {block.type === 'text' && (
          <Section title="Text" accent={BLOCK_COLOR.text}>
            <TextArea
              value={block.props.text}
              onChange={(text) => updateProps(block.id, { text })}
              rows={3}
            />
            <Row label="字号">
              <NumberField
                value={block.props.fontSize}
                onChange={(fontSize) => updateProps(block.id, { fontSize })}
                min={8}
                max={400}
                suffix="px"
              />
            </Row>
            <Row label="颜色">
              <ColorField
                value={block.props.color}
                onChange={(color) => updateProps(block.id, { color })}
              />
            </Row>
            <Row label="字重">
              <Segmented
                value={String(block.props.fontWeight)}
                options={[
                  { value: '400', label: '常规' },
                  { value: '500', label: '中等' },
                  { value: '700', label: '粗' },
                  { value: '900', label: '特粗' },
                ]}
                onChange={(v) => updateProps(block.id, { fontWeight: Number(v) })}
              />
            </Row>
            <Row label="对齐">
              <Segmented
                value={block.props.align}
                options={ALIGN_OPTIONS}
                onChange={(align) => updateProps(block.id, { align })}
              />
            </Row>
            <Row label="字距">
              <SliderField
                value={block.props.letterSpacing}
                onChange={(letterSpacing) => updateProps(block.id, { letterSpacing })}
                min={-20}
                max={40}
                step={0.5}
                format={(v) => v.toFixed(1)}
              />
            </Row>
            <Row label="行高">
              <SliderField
                value={block.props.lineHeight}
                onChange={(lineHeight) => updateProps(block.id, { lineHeight })}
                min={0.8}
                max={2.4}
                step={0.05}
              />
            </Row>
            <Row label="宽度">
              <NumberField
                value={block.props.maxWidth}
                onChange={(maxWidth) => updateProps(block.id, { maxWidth })}
                min={50}
                max={1920}
                step={10}
                suffix="px"
              />
            </Row>
          </Section>
        )}

        {block.type === 'video' && (
          <Section title="Video" accent={BLOCK_COLOR.video}>
            <button
              onClick={replaceMedia}
              disabled={uploading}
              className="w-full rounded-md border border-dashed border-stroke bg-panel-3 py-2 text-[11.5px] text-ink-dim hover:border-video hover:text-ink disabled:opacity-50"
            >
              {uploading ? '选择中…' : block.props.src ? '替换视频' : '上传 MP4'}
            </button>
            <Toggle
              label="作为背景铺满"
              value={block.props.background}
              onChange={(background) => updateProps(block.id, { background })}
            />
            <Toggle
              label="播放"
              value={block.props.playing}
              onChange={(playing) => updateProps(block.id, { playing })}
            />
            <Toggle
              label="循环"
              value={block.props.loop}
              onChange={(loop) => updateProps(block.id, { loop })}
            />
            <Toggle
              label="静音"
              value={block.props.muted}
              onChange={(muted) => updateProps(block.id, { muted })}
            />
            <Row label="填充">
              <Segmented
                value={block.props.objectFit}
                options={FIT_OPTIONS}
                onChange={(objectFit) => updateProps(block.id, { objectFit })}
              />
            </Row>
            {!block.props.background && (
              <Row label="尺寸">
                <div className="flex gap-2">
                  <NumberField
                    value={block.props.width}
                    onChange={(width) => updateProps(block.id, { width })}
                    min={1}
                    suffix="W"
                  />
                  <NumberField
                    value={block.props.height}
                    onChange={(height) => updateProps(block.id, { height })}
                    min={1}
                    suffix="H"
                  />
                </div>
              </Row>
            )}
          </Section>
        )}

        {block.type === 'spotlight' && (
          <Section title="Spotlight" accent={BLOCK_COLOR.spotlight}>
            <Row label="尺寸">
              <div className="flex gap-2">
                <NumberField value={block.props.width} onChange={(width) => updateProps(block.id, { width })} min={1} suffix="W" />
                <NumberField value={block.props.height} onChange={(height) => updateProps(block.id, { height })} min={1} suffix="H" />
              </div>
            </Row>
            <Row label="半径">
              <SliderField value={block.props.radius} onChange={(radius) => updateProps(block.id, { radius })} min={20} max={900} step={5} format={(v) => `${Math.round(v)}`} />
            </Row>
            <Row label="羽化">
              <SliderField value={block.props.softness} onChange={(softness) => updateProps(block.id, { softness })} min={0} max={400} step={5} format={(v) => `${Math.round(v)}`} />
            </Row>
            <Row label="暗度">
              <SliderField value={block.props.dim} onChange={(dim) => updateProps(block.id, { dim })} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} />
            </Row>
            <Row label="染色">
              <ColorField value={block.props.tint} onChange={(tint) => updateProps(block.id, { tint })} />
            </Row>
          </Section>
        )}

        {block.type === 'glassui' && (
          <Section title="GlassUI" accent={BLOCK_COLOR.glassui}>
            <Row label="尺寸">
              <div className="flex gap-2">
                <NumberField value={block.props.width} onChange={(width) => updateProps(block.id, { width })} min={1} suffix="W" />
                <NumberField value={block.props.height} onChange={(height) => updateProps(block.id, { height })} min={1} suffix="H" />
              </div>
            </Row>
            <Row label="圆角">
              <SliderField value={block.props.radius} onChange={(radius) => updateProps(block.id, { radius })} min={0} max={200} step={1} format={(v) => `${Math.round(v)}`} />
            </Row>
            <Row label="模糊">
              <SliderField value={block.props.blur} onChange={(blur) => updateProps(block.id, { blur })} min={0} max={60} step={1} format={(v) => `${Math.round(v)}px`} />
            </Row>
            <Row label="底色">
              <ColorField value={block.props.tint} onChange={(tint) => updateProps(block.id, { tint })} />
            </Row>
            <Row label="描边">
              <ColorField value={block.props.border} onChange={(border) => updateProps(block.id, { border })} />
            </Row>
            <Row label="边宽">
              <NumberField value={block.props.borderWidth} onChange={(borderWidth) => updateProps(block.id, { borderWidth })} min={0} max={10} suffix="px" />
            </Row>
          </Section>
        )}

        {block.type === 'chart' && (
          <Section title="Chart" accent={BLOCK_COLOR.chart}>
            <Row label="类型">
              <Segmented value={block.props.type} options={CHART_TYPE_OPTIONS} onChange={(type) => updateProps(block.id, { type })} />
            </Row>
            <Row label="数据">
              <TextArea value={block.props.data} onChange={(data) => updateProps(block.id, { data })} rows={2} />
            </Row>
            <Row label="标签">
              <TextArea value={block.props.labels || ''} onChange={(labels) => updateProps(block.id, { labels })} rows={2} />
            </Row>
            <Row label="标题">
              <input
                value={block.props.title}
                onChange={(e) => updateProps(block.id, { title: e.target.value })}
                className="w-full rounded-md border border-stroke bg-panel-3 px-2 py-[6px] text-[12px] text-ink outline-none focus:border-accent"
              />
            </Row>
            <Row label="颜色">
              <ColorField value={block.props.color} onChange={(color) => updateProps(block.id, { color })} />
            </Row>
            <Row label="辅色">
              <ColorField value={block.props.secondaryColor || '#38bdf8'} onChange={(secondaryColor) => updateProps(block.id, { secondaryColor })} />
            </Row>
            <Row label="文字">
              <ColorField value={block.props.textColor || '#ffffff'} onChange={(textColor) => updateProps(block.id, { textColor })} />
            </Row>
            <Row label="单位">
              <input value={block.props.unit || ''} onChange={(e) => updateProps(block.id, { unit: e.target.value })} placeholder="例如 % / 万" className="w-full rounded-md border border-stroke bg-panel-3 px-2 py-[6px] text-[12px] text-ink outline-none focus:border-accent" />
            </Row>
            <Row label="背景">
              <ColorField value={block.props.bg} onChange={(bg) => updateProps(block.id, { bg })} />
            </Row>
            <Row label="圆角">
              <SliderField value={block.props.radius} onChange={(radius) => updateProps(block.id, { radius })} min={0} max={80} step={1} format={(v) => `${Math.round(v)}`} />
            </Row>
            <Toggle label="显示网格" value={block.props.showGrid} onChange={(showGrid) => updateProps(block.id, { showGrid })} />
            <Toggle label="显示数值" value={block.props.showValues ?? true} onChange={(showValues) => updateProps(block.id, { showValues })} />
            <Row label="尺寸">
              <div className="flex gap-2">
                <NumberField value={block.props.width} onChange={(width) => updateProps(block.id, { width })} min={50} suffix="W" />
                <NumberField value={block.props.height} onChange={(height) => updateProps(block.id, { height })} min={50} suffix="H" />
              </div>
            </Row>
          </Section>
        )}

        {block.type === 'cursor' && (
          <Section title="Cursor · 鼠标教学" accent={BLOCK_COLOR.cursor}>
            <Row label="动作"><Segmented value={block.props.action} options={CURSOR_ACTION_OPTIONS} onChange={(action) => updateProps(block.id, { action })} /></Row>
            <Row label="终点">
              <div className="flex gap-2">
                <NumberField value={block.props.endX} onChange={(endX) => updateProps(block.id, { endX })} suffix="X" />
                <NumberField value={block.props.endY} onChange={(endY) => updateProps(block.id, { endY })} suffix="Y" />
              </div>
            </Row>
            <Row label="指针"><ColorField value={block.props.cursorColor} onChange={(cursorColor) => updateProps(block.id, { cursorColor })} /></Row>
            <Row label="轮廓"><ColorField value={block.props.outlineColor} onChange={(outlineColor) => updateProps(block.id, { outlineColor })} /></Row>
            <Row label="点击色"><ColorField value={block.props.clickColor} onChange={(clickColor) => updateProps(block.id, { clickColor })} /></Row>
            <Toggle label="显示点击波纹" value={block.props.showTrail} onChange={(showTrail) => updateProps(block.id, { showTrail })} />
            <p className="text-[10.5px] leading-relaxed text-ink-faint">画布中的位置是起点；终点可在这里输入。动作速度跟随底部时间轴片段长度。</p>
          </Section>
        )}

        {block.type === 'card' && (
          <Section title="Card" accent={BLOCK_COLOR.card}>
            <Row label="眉题"><input value={block.props.eyebrow} onChange={(e) => updateProps(block.id, { eyebrow: e.target.value })} className="w-full rounded-md border border-stroke bg-panel-3 px-2 py-[6px] text-[12px] text-ink outline-none focus:border-accent" /></Row>
            <TextArea value={block.props.title} onChange={(title) => updateProps(block.id, { title })} rows={2} />
            <TextArea value={block.props.body} onChange={(body) => updateProps(block.id, { body })} rows={3} />
            <Row label="对齐"><Segmented value={block.props.align} options={[{ value: 'left', label: '左' }, { value: 'center', label: '中' }]} onChange={(align) => updateProps(block.id, { align })} /></Row>
            <Toggle label="显示强调线" value={block.props.showAccent} onChange={(showAccent) => updateProps(block.id, { showAccent })} />
            <Row label="强调色"><ColorField value={block.props.accent} onChange={(accent) => updateProps(block.id, { accent })} /></Row>
            <Row label="标题色"><ColorField value={block.props.titleColor} onChange={(titleColor) => updateProps(block.id, { titleColor })} /></Row>
            <Row label="正文色"><ColorField value={block.props.bodyColor} onChange={(bodyColor) => updateProps(block.id, { bodyColor })} /></Row>
            <Row label="背景"><ColorField value={block.props.bg} onChange={(bg) => updateProps(block.id, { bg })} /></Row>
            <Row label="描边"><ColorField value={block.props.border} onChange={(border) => updateProps(block.id, { border })} /></Row>
            <Row label="圆角"><SliderField value={block.props.radius} onChange={(radius) => updateProps(block.id, { radius })} min={0} max={100} step={1} format={(v) => `${Math.round(v)}`} /></Row>
            <Row label="内边距"><SliderField value={block.props.padding} onChange={(padding) => updateProps(block.id, { padding })} min={12} max={120} step={2} format={(v) => `${Math.round(v)}px`} /></Row>
            <Row label="尺寸"><div className="flex gap-2"><NumberField value={block.props.width} onChange={(width) => updateProps(block.id, { width })} min={100} suffix="W" /><NumberField value={block.props.height} onChange={(height) => updateProps(block.id, { height })} min={100} suffix="H" /></div></Row>
          </Section>
        )}

        {block.type === 'scrollstory' && (
          <Section title="ScrollStory" accent={BLOCK_COLOR.scrollstory}>
            <TextArea value={block.props.text} onChange={(text) => updateProps(block.id, { text })} rows={4} />
            <Row label="字号">
              <NumberField value={block.props.fontSize} onChange={(fontSize) => updateProps(block.id, { fontSize })} min={12} max={120} suffix="px" />
            </Row>
            <Row label="颜色">
              <ColorField value={block.props.color} onChange={(color) => updateProps(block.id, { color })} />
            </Row>
            <Row label="字重">
              <Segmented
                value={String(block.props.fontWeight)}
                options={[
                  { value: '400', label: '常规' },
                  { value: '500', label: '中等' },
                  { value: '700', label: '粗' },
                ]}
                onChange={(v) => updateProps(block.id, { fontWeight: Number(v) })}
              />
            </Row>
            <Row label="对齐">
              <Segmented value={block.props.align} options={ALIGN_OPTIONS} onChange={(align) => updateProps(block.id, { align })} />
            </Row>
            <Row label="行高">
              <SliderField value={block.props.lineHeight} onChange={(lineHeight) => updateProps(block.id, { lineHeight })} min={0.8} max={2.4} step={0.05} />
            </Row>
            <Row label="速度">
              <SliderField value={block.props.speed} onChange={(speed) => updateProps(block.id, { speed })} min={0} max={300} step={5} format={(v) => `${Math.round(v)}px/s`} />
            </Row>
            <Row label="背景">
              <ColorField value={block.props.bg} onChange={(bg) => updateProps(block.id, { bg })} />
            </Row>
            <Row label="视口">
              <div className="flex gap-2">
                <NumberField value={block.props.width} onChange={(width) => updateProps(block.id, { width })} min={50} suffix="W" />
                <NumberField value={block.props.height} onChange={(height) => updateProps(block.id, { height })} min={50} suffix="H" />
              </div>
            </Row>
          </Section>
        )}

        {block.type === 'subtitle' && (
          <Section title="Subtitle" accent={BLOCK_COLOR.subtitle}>
            <TextArea value={block.props.text} onChange={(text) => updateProps(block.id, { text })} rows={2} />
            <Row label="字号">
              <NumberField value={block.props.fontSize} onChange={(fontSize) => updateProps(block.id, { fontSize })} min={12} max={160} suffix="px" />
            </Row>
            <Row label="颜色">
              <ColorField value={block.props.color} onChange={(color) => updateProps(block.id, { color })} />
            </Row>
            <Row label="底衬">
              <ColorField value={block.props.bg} onChange={(bg) => updateProps(block.id, { bg })} />
            </Row>
            <Row label="字重">
              <Segmented
                value={String(block.props.fontWeight)}
                options={[
                  { value: '400', label: '常规' },
                  { value: '500', label: '中等' },
                  { value: '700', label: '粗' },
                ]}
                onChange={(v) => updateProps(block.id, { fontWeight: Number(v) })}
              />
            </Row>
            <Row label="对齐">
              <Segmented value={block.props.align} options={ALIGN_OPTIONS} onChange={(align) => updateProps(block.id, { align })} />
            </Row>
            <Row label="字距">
              <SliderField value={block.props.letterSpacing} onChange={(letterSpacing) => updateProps(block.id, { letterSpacing })} min={-10} max={30} step={0.5} format={(v) => v.toFixed(1)} />
            </Row>
            <Row label="行高">
              <SliderField value={block.props.lineHeight} onChange={(lineHeight) => updateProps(block.id, { lineHeight })} min={0.8} max={2.4} step={0.05} />
            </Row>
            <Row label="内边距">
              <div className="flex gap-2">
                <NumberField value={block.props.paddingX} onChange={(paddingX) => updateProps(block.id, { paddingX })} min={0} suffix="X" />
                <NumberField value={block.props.paddingY} onChange={(paddingY) => updateProps(block.id, { paddingY })} min={0} suffix="Y" />
              </div>
            </Row>
            <Row label="宽度">
              <NumberField value={block.props.maxWidth} onChange={(maxWidth) => updateProps(block.id, { maxWidth })} min={50} max={1920} step={10} suffix="px" />
            </Row>
          </Section>
        )}

        {block.type === 'voice' && (
          <Section title="Voice · AI 配音" accent={BLOCK_COLOR.voice}>
            <TextArea value={block.props.text} onChange={(text) => updateProps(block.id, { text })} rows={4} />
            <Row label="发音人">
              <input
                value={block.props.voiceName}
                onChange={(e) => updateProps(block.id, { voiceName: e.target.value })}
                className="w-full rounded-md border border-stroke bg-panel-3 px-2 py-1.5 text-[11px] text-ink outline-none focus:border-accent"
                placeholder="x6_lingyuyan_pro"
              />
            </Row>
            <Row label="语速">
              <SliderField value={block.props.speed} onChange={(speed) => updateProps(block.id, { speed })} min={25} max={100} step={1} format={(v) => `${Math.round(v)}`} />
            </Row>
            <Row label="音量">
              <SliderField value={block.props.volume} onChange={(volume) => updateProps(block.id, { volume })} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} />
            </Row>
            <Row label="音频时长">
              <NumberField value={block.props.duration} onChange={(duration) => updateProps(block.id, { duration })} min={0} max={3600} step={0.1} suffix="秒" />
            </Row>
            <div className="rounded-md border border-dashed border-cyan-300/30 bg-cyan-300/5 px-3 py-2 text-[10.5px] leading-relaxed text-cyan-100/70">
              {block.props.src ? '音频已挂载，可在画布中预览。' : '当前为音频占位；接入 TTS 后将把生成的音频地址写入这里。'}
            </div>
          </Section>
        )}

        {/* ---------------- Animation ---------------- */}
        <Section title="Animation · 入场">
          <Segmented value={anim.type} options={ANIM_OPTIONS} onChange={(type) => updateAnimation(block.id, { type })} />

          {anim.type !== 'none' && (
            <>
              <Row label="时长">
                <NumberField
                  value={anim.duration}
                  onChange={(duration) => updateAnimation(block.id, { duration })}
                  min={0.05}
                  max={10}
                  step={0.05}
                  precision={2}
                  suffix="s"
                />
              </Row>
              <Row label="延迟">
                <NumberField
                  value={anim.delay}
                  onChange={(delay) => updateAnimation(block.id, { delay })}
                  min={0}
                  max={10}
                  step={0.05}
                  precision={2}
                  suffix="s"
                />
              </Row>
              <Row label="缓动">
                <Segmented
                  value={anim.easing}
                  options={EASE_OPTIONS}
                  onChange={(easing) => updateAnimation(block.id, { easing })}
                />
              </Row>
              <EasingCurve easing={anim.easing} />
              {anim.type === 'slide' && (
                <>
                  <Row label="方向">
                    <Segmented
                      value={anim.direction}
                      options={DIR_OPTIONS}
                      onChange={(direction) => updateAnimation(block.id, { direction })}
                    />
                  </Row>
                  <Row label="距离">
                    <SliderField
                      value={anim.distance}
                      onChange={(distance) => updateAnimation(block.id, { distance })}
                      min={10}
                      max={1200}
                      step={10}
                      format={(v) => `${Math.round(v)}`}
                    />
                  </Row>
                </>
              )}
              {anim.type === 'scale' && (
                <Row label="起始">
                  <SliderField
                    value={anim.from}
                    onChange={(from) => updateAnimation(block.id, { from })}
                    min={0}
                    max={2}
                    step={0.05}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                </Row>
              )}
              <button
                onClick={() => setTime(block.start)}
                className="w-full rounded-md border border-stroke bg-panel-3 py-[6px] text-[11px] text-ink-dim hover:border-accent hover:text-ink"
              >
                ↺ 跳到入点预览动画
              </button>
            </>
          )}
        </Section>

        {/* ---------------- Timing ---------------- */}
        <Section title="Timing">
          <Row label="入点">
            <NumberField
              value={block.start}
              onChange={(start) => updateBlock(block.id, { start: Math.max(0, start) })}
              min={0}
              step={0.1}
              precision={2}
              suffix="s"
            />
          </Row>
          <Row label="时长">
            <NumberField
              value={block.duration}
              onChange={(duration) => updateBlock(block.id, { duration: Math.max(0.1, duration) })}
              min={0.1}
              step={0.1}
              precision={2}
              suffix="s"
            />
          </Row>
          <div className="flex gap-2">
            <Toggle
              label="可见"
              value={block.visible}
              onChange={(visible) => updateBlock(block.id, { visible })}
            />
          </div>
        </Section>

        {/* ---------------- 操作 ---------------- */}
        <div className="flex gap-2 px-4 py-4">
          <button
            onClick={() => duplicateBlock(block.id)}
            className="flex-1 rounded-md border border-stroke bg-panel-3 py-[7px] text-[11.5px] text-ink-dim hover:border-accent hover:text-ink"
          >
            复制
          </button>
          <button
            onClick={() => removeBlock(block.id)}
            className="flex-1 rounded-md border border-red-500/25 bg-red-500/10 py-[7px] text-[11.5px] text-red-300 hover:bg-red-500/20"
          >
            删除
          </button>
        </div>
      </div>
    </aside>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-stroke px-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
        {title}
      </h2>
    </div>
  );
}

/** 缓动曲线预览：把 EASINGS 纯函数采样成折线，直观看到动画「怎么动」 */
function EasingCurve({ easing }: { easing: EasingName }) {
  const W = 132;
  const H = 40;
  const N = 48;
  const fn = EASINGS[easing] ?? EASINGS.linear;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const v = Math.max(0, Math.min(1, fn(p)));
    pts.push(`${(p * W).toFixed(1)},${(H - v * H).toFixed(1)}`);
  }
  const label = EASE_OPTIONS.find((o) => o.value === easing)?.label ?? easing;
  return (
    <div className="flex items-center gap-2 rounded-md border border-stroke bg-panel-3 px-2 py-1.5">
      <svg width={W} height={H} className="shrink-0">
        <line x1="0" y1={H} x2={W} y2={H} stroke="#2c313a" strokeWidth="1" />
        <line x1="0" y1="0" x2="0" y2={H} stroke="#2c313a" strokeWidth="1" />
        <path d={`M${pts.join(' L')}`} fill="none" stroke="#5b8cff" strokeWidth="1.6" />
      </svg>
      <span className="text-[10.5px] text-ink-dim">{label} 曲线</span>
    </div>
  );
}
