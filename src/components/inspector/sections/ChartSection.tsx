import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { ColorField, Row, Section, Segmented, SliderField, TextArea, Toggle } from '@/components/ui/Field';
import { CHART_TYPE_OPTIONS, SizeRow, TextField } from './common';

export default function ChartSection({ block }: { block: Extract<Block, { type: 'chart' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);

  return (
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
        <TextField value={block.props.title} onChange={(title) => updateProps(block.id, { title })} />
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
        <TextField value={block.props.unit || ''} onChange={(unit) => updateProps(block.id, { unit })} placeholder="例如 % / 万" />
      </Row>
      <Row label="背景">
        <ColorField value={block.props.bg} onChange={(bg) => updateProps(block.id, { bg })} />
      </Row>
      <Row label="圆角">
        <SliderField value={block.props.radius} onChange={(radius) => updateProps(block.id, { radius })} min={0} max={80} step={1} format={(v) => `${Math.round(v)}`} />
      </Row>
      <Toggle label="显示网格" value={block.props.showGrid} onChange={(showGrid) => updateProps(block.id, { showGrid })} />
      <Toggle label="显示数值" value={block.props.showValues ?? true} onChange={(showValues) => updateProps(block.id, { showValues })} />
      <SizeRow
        width={block.props.width}
        height={block.props.height}
        min={50}
        onChange={(patch) => updateProps(block.id, patch)}
      />
    </Section>
  );
}
