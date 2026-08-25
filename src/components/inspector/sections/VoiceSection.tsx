import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { NumberField, Row, Section, SliderField, TextArea } from '@/components/ui/Field';
import { TextField } from './common';

export default function VoiceSection({ block }: { block: Extract<Block, { type: 'voice' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);

  return (
    <Section title="Voice · AI 配音" accent={BLOCK_COLOR.voice}>
      <TextArea value={block.props.text} onChange={(text) => updateProps(block.id, { text })} rows={4} />
      <Row label="发音人">
        <TextField
          value={block.props.voiceName}
          onChange={(voiceName) => updateProps(block.id, { voiceName })}
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
  );
}
