import type { Block } from '@/types';
import { useEditorStore, useSelectedBlock } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { NumberField, Row, Section, SliderField, Toggle } from '@/components/ui/Field';
import { PROPERTY_SECTIONS } from './sections';
import AnimationSection from './sections/AnimationSection';

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

export default function PropertyPanel() {
  const block = useSelectedBlock();

  const updateBlock = useEditorStore((s) => s.updateBlock);
  const updateProps = useEditorStore((s) => s.updateProps);
  const removeBlock = useEditorStore((s) => s.removeBlock);
  const duplicateBlock = useEditorStore((s) => s.duplicateBlock);
  const reorderLayer = useEditorStore((s) => s.reorderLayer);

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

  // 注册表按具体积木类型收窄了 props；此处已由 block.type 索引保证对应关系
  const TypeSection = PROPERTY_SECTIONS[block.type] as React.FC<{ block: Block }>;

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

        {/* ---------------- 按类型的专属参数（注册表驱动） ---------------- */}
        <TypeSection block={block} />

        {/* ---------------- Animation ---------------- */}
        <AnimationSection block={block} />

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
