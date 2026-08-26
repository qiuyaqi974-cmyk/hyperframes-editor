import { useRef, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';

/**
 * 口播生产线入口：导入整篇口播稿（.txt / .md），
 * 逐句讯飞 TTS → 按每句音频时长自动生成 配音块 + 字幕 + 场景轨。
 *
 * 与 Remotion 管线「口播按音频时长锁定时间线」同构，
 * 但时间线在编辑器里可视化可调；素材随后用「自动匹配到字幕」对位。
 */
export default function VoiceoverPipelineLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setBusy(true);
    setStatus('正在逐句合成配音…');
    try {
      const script = await file.text();
      const count = await useEditorStore.getState().importVoiceoverScript(script);
      setStatus(`已生成 ${count} 句配音 + 字幕 + 场景，可在时间轴微调。`);
    } catch (error) {
      setStatus(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="w-full rounded-md border border-teal-300/40 bg-teal-300/10 px-2.5 py-[6px] text-[11px] font-medium text-teal-100 text-left hover:bg-teal-300/20 disabled:opacity-50"
      >
        {busy ? '合成中…' : '口播稿转时间轴（.txt）'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.md,text/plain"
        className="hidden"
        onChange={handleFile}
      />
      {status && (
        <span className="text-[10px] leading-relaxed text-ink-faint" title={status}>
          {status}
        </span>
      )}
    </span>
  );
}
