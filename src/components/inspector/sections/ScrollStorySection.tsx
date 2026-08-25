import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { ColorField, NumberField, Row, Section, Segmented, SliderField, TextArea } from '@/components/ui/Field';
import { ALIGN_OPTIONS, WEIGHT_OPTIONS_3, SizeRow } from './common';

export default function ScrollStorySection({ block }: { block: Extract<Block, { type: 'scrollstory' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);

  return (
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
          options={WEIGHT_OPTIONS_3}
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
      <SizeRow
        label="视口"
        width={block.props.width}
        height={block.props.height}
        min={50}
        onChange={(patch) => updateProps(block.id, patch)}
      />
    </Section>
  );
}
