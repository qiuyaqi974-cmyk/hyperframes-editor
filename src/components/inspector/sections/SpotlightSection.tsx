import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { ColorField, Row, Section, SliderField } from '@/components/ui/Field';
import { SizeRow } from './common';

export default function SpotlightSection({ block }: { block: Extract<Block, { type: 'spotlight' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);

  return (
    <Section title="Spotlight" accent={BLOCK_COLOR.spotlight}>
      <SizeRow
        width={block.props.width}
        height={block.props.height}
        onChange={(patch) => updateProps(block.id, patch)}
      />
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
  );
}
