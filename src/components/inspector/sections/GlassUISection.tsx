import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { ColorField, NumberField, Row, Section, SliderField } from '@/components/ui/Field';
import { SizeRow } from './common';

export default function GlassUISection({ block }: { block: Extract<Block, { type: 'glassui' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);

  return (
    <Section title="GlassUI" accent={BLOCK_COLOR.glassui}>
      <SizeRow
        width={block.props.width}
        height={block.props.height}
        onChange={(patch) => updateProps(block.id, patch)}
      />
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
  );
}
