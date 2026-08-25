import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { ColorField, NumberField, Row, Section, Segmented, Toggle } from '@/components/ui/Field';
import { CURSOR_ACTION_OPTIONS } from './common';

export default function CursorSection({ block }: { block: Extract<Block, { type: 'cursor' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);

  return (
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
  );
}
