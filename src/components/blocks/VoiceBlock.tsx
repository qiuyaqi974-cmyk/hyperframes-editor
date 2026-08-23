import type { Block, EvaluatedFrame } from '@/types';

interface Props {
  block: Extract<Block, { type: 'voice' }>;
  frame: EvaluatedFrame;
}

/**
 * VoiceBlock MVP：先把配音文案、音色和时间轴窗口可视化。
 * src 一旦由后续 TTS 流程填入，这里也会提供一个原生音频预览。
 */
export default function VoiceBlock({ block }: Props) {
  const { props } = block;
  const hasAudio = Boolean(props.src);

  return (
    <div
      className="flex h-full w-full flex-col justify-between overflow-hidden rounded-xl border border-cyan-300/25 bg-slate-950/90 p-4 text-cyan-50 shadow-lg shadow-cyan-950/20"
      style={{ opacity: props.opacity }}
    >
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <span aria-hidden="true" className="text-xl">🎙</span>
        <span>{block.name}</span>
        <span className="ml-auto rounded-full bg-cyan-300/15 px-2 py-1 text-[10px] font-medium text-cyan-200">
          {hasAudio ? '音频已生成' : '音频占位'}
        </span>
      </div>

      <div className="mt-2 min-h-0 flex-1">
        <p className="line-clamp-2 whitespace-pre-wrap text-[12px] leading-relaxed text-cyan-50/80">
          {props.text}
        </p>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-cyan-200/65">
          <span>{props.voiceName}</span>
          <span>语速 {props.speed}</span>
          <span>音量 {props.volume}</span>
        </div>
      </div>

      {hasAudio ? (
        <audio className="mt-2 h-7 w-full" controls preload="metadata" src={props.src ?? undefined} />
      ) : (
        <div className="mt-3 flex items-center gap-1.5" aria-label="音频占位波形">
          {Array.from({ length: 28 }, (_, index) => (
            <span
              key={index}
              className="w-1 rounded-full bg-cyan-300/60"
              style={{ height: `${8 + ((index * 17) % 20)}px` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
