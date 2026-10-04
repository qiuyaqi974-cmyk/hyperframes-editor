import { useState } from 'react';
import { generateBatchVoiceover, type BatchVoiceFailure, type BatchVoiceProgress } from '@/lib/pipeline/batchVoiceover';
import { useEditorStore } from '@/store/editorStore';
import { lockedSceneIds } from '@/lib/directorDecision';

export default function BatchVoiceoverPanel() {
  const blocks = useEditorStore((state) => state.blocks);
  const scenes = useEditorStore((state) => state.scenes);
  const director = useEditorStore((state) => state.director);
  const voiceBlocks = blocks.filter((block) => block.type === 'voice');
  const lockedIds = new Set(lockedSceneIds(director, scenes));
  const editableVoiceCount = voiceBlocks.filter((block) => !block.sceneId || !lockedIds.has(block.sceneId)).length;
  const canUndo = useEditorStore((state) => Boolean(state.voiceTimelineUndo));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BatchVoiceProgress | null>(null);
  const [failures, setFailures] = useState<BatchVoiceFailure[]>([]);
  const [status, setStatus] = useState('');

  const run = async (onlyBlockIds?: string[]) => {
    if (busy) return;
    const previous = useEditorStore.getState().exportSnapshot();
    if (!voiceBlocks.length) {
      setStatus('当前没有旁白积木；请先导入口播稿或生成导演场景。');
      return;
    }
    setBusy(true);
    setFailures([]);
    setStatus('正在准备批量配音…');
    try {
      const result = await generateBatchVoiceover(previous, {
        onlyBlockIds,
        onProgress: (next) => {
          setProgress(next);
          setStatus(next.currentBlockName ? `正在生成：${next.currentBlockName}` : '正在重排时间轴…');
        },
      });
      useEditorStore.getState().applyVoiceTimeline(result.snapshot, previous);
      setFailures(result.failures);
      const parts = [`新生成 ${result.generated}`, `复用 ${result.reused}`];
      if (result.skippedLocked) parts.push(`跳过锁定 ${result.skippedLocked}`);
      if (result.failures.length) parts.push(`失败 ${result.failures.length}`);
      if (result.overlapWarnings.length) parts.push(`时间重叠 ${result.overlapWarnings.length}`);
      setStatus(`批量配音完成：${parts.join(' · ')}`);
    } catch (error) {
      setStatus(`批量配音失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const percent = progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <span className="inline-flex flex-col gap-1.5 rounded-md border border-cyan-300/20 bg-cyan-300/[0.04] p-2">
      <span className="flex items-center justify-between gap-2 text-[10px] text-ink-faint">
        <span>{voiceBlocks.length} 条旁白 · 可生成 {editableVoiceCount}</span>
        <span>68 / 56 / 48</span>
      </span>
      <button type="button" onClick={() => void run()} disabled={busy || !editableVoiceCount} className="w-full rounded-md bg-cyan-400 px-2.5 py-1.5 text-left text-[11px] font-semibold text-[#08202a] disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? `批量生成中 ${percent}%` : editableVoiceCount ? '一键生成全部配音并重排时间轴' : '旁白场景已全部锁定'}
      </button>
      {busy && <span className="h-1 overflow-hidden rounded-full bg-black/30"><span className="block h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${percent}%` }} /></span>}
      {status && <span className="text-[10px] leading-relaxed text-ink-faint">{status}</span>}
      {failures.length > 0 && (
        <span className="rounded border border-amber-300/20 bg-amber-300/[0.05] p-1.5">
          {failures.map((failure) => <span key={failure.blockId} className="block truncate text-[9.5px] text-amber-100/80" title={failure.message}>{failure.blockName}：{failure.message}</span>)}
          <button type="button" onClick={() => void run(failures.map((failure) => failure.blockId))} disabled={busy} className="mt-1 text-[10px] font-medium text-amber-200 underline underline-offset-2">只重试失败项</button>
        </span>
      )}
      {canUndo && !busy && <button type="button" onClick={() => { if (useEditorStore.getState().undoVoiceTimeline()) setStatus('已撤销上一次批量配音与时间轴重排。'); }} className="self-start text-[10px] text-ink-faint underline underline-offset-2 hover:text-ink">撤销上一次批量配音</button>}
    </span>
  );
}
