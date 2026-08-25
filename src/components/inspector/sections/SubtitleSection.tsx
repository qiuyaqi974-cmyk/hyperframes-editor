import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { ColorField, NumberField, Row, Section, Segmented, SliderField, TextArea } from '@/components/ui/Field';
import { ALIGN_OPTIONS, WEIGHT_OPTIONS_3 } from './common';

export default function SubtitleSection({ block }: { block: Extract<Block, { type: 'subtitle' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);

  return (
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
          options={WEIGHT_OPTIONS_3}
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
  );
}
