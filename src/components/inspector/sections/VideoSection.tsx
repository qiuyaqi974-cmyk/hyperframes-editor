import type { Block } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';
import { Row, Section, Segmented, Toggle } from '@/components/ui/Field';
import { FIT_OPTIONS, MediaUploadButton, SizeRow, useReplaceMedia } from './common';

export default function VideoSection({ block }: { block: Extract<Block, { type: 'video' }> }) {
  const updateProps = useEditorStore((s) => s.updateProps);
  const { uploading, replaceMedia } = useReplaceMedia(block);

  return (
    <Section title="Video" accent={BLOCK_COLOR.video}>
      <MediaUploadButton kind="video" uploading={uploading} hasSrc={Boolean(block.props.src)} onClick={replaceMedia} />
      <Toggle
        label="作为背景铺满"
        value={block.props.background}
        onChange={(background) => updateProps(block.id, { background })}
      />
      <Toggle
        label="播放"
        value={block.props.playing}
        onChange={(playing) => updateProps(block.id, { playing })}
      />
      <Toggle
        label="循环"
        value={block.props.loop}
        onChange={(loop) => updateProps(block.id, { loop })}
      />
      <Toggle
        label="静音"
        value={block.props.muted}
        onChange={(muted) => updateProps(block.id, { muted })}
      />
      <Row label="填充">
        <Segmented
          value={block.props.objectFit}
          options={FIT_OPTIONS}
          onChange={(objectFit) => updateProps(block.id, { objectFit })}
        />
      </Row>
      {!block.props.background && (
        <SizeRow
          width={block.props.width}
          height={block.props.height}
          onChange={(patch) => updateProps(block.id, patch)}
        />
      )}
    </Section>
  );
}
