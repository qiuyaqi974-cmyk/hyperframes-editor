import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { ColorField, Row, Section, Segmented, SliderField, TextArea, Toggle } from '@/components/ui/Field';
import { SizeRow, TextField } from './common';

export default function CardSection({ block }: { block: Extract<Block, { type: 'card' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);

  return (
    <Section title="Card" accent={BLOCK_COLOR.card}>
      <Row label="眉题"><TextField value={block.props.eyebrow} onChange={(eyebrow) => updateProps(block.id, { eyebrow })} /></Row>
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
      <SizeRow
        width={block.props.width}
        height={block.props.height}
        min={100}
        onChange={(patch) => updateProps(block.id, patch)}
      />
    </Section>
  );
}
