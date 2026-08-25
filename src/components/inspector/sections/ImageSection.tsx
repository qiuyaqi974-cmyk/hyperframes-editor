import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { Row, Section, SliderField, TextArea } from '@/components/ui/Field';
import { MediaUploadButton, SizeRow, useReplaceMedia } from './common';

export default function ImageSection({ block }: { block: Extract<Block, { type: 'image' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);
  const assets = useEditorStore((s) => s.assets);
  const { uploading, replaceMedia } = useReplaceMedia(block);

  return (
    <Section title="Image" accent={BLOCK_COLOR.image}>
      <div className="mb-2 rounded-md border border-stroke bg-panel-3 px-2.5 py-2 text-[11px]">
        <div className="text-ink-faint">视觉需求</div>
        <div className="mt-1 break-words leading-relaxed text-ink-dim">
          {block.props.visualPrompt || '未设置视觉提示词'}
        </div>
        <div className="mt-2 text-ink-faint">当前素材</div>
        <div className="mt-1 truncate text-ink-dim">
          {assets.find((asset) => asset.id === block.props.assetId)?.name || '未匹配素材'}
        </div>
      </div>
      <MediaUploadButton kind="image" uploading={uploading} hasSrc={Boolean(block.props.src)} onClick={replaceMedia} />
      <Row label="视觉提示词">
        <TextArea
          value={block.props.visualPrompt ?? ''}
          onChange={(visualPrompt) => updateProps(block.id, { visualPrompt })}
          rows={3}
        />
      </Row>
      <SizeRow
        width={block.props.width}
        height={block.props.height}
        onChange={(patch) => updateProps(block.id, patch)}
      />
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
  );
}
