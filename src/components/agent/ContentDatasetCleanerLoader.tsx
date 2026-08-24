import { useRef, useState } from 'react';
import { cleanContentWorkbook } from '@/lib/contentDatasetCleaner/excelImporter';

export default function ContentDatasetCleanerLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const { cases, stats } = await cleanContentWorkbook(file);
      const blob = new Blob([JSON.stringify(cases, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'content-cases-cleaned.json';
      anchor.click();
      URL.revokeObjectURL(url);
      const missing = Object.entries(stats.missing).filter(([, count]) => count > 0).map(([field, count]) => `${field}:${count}`).join('、') || '无';
      setStatus(`总数 ${stats.total} · 有效 ${stats.usable} · 广告 ${stats.advertisements} · 缺失 ${missing}`);
    } catch (error) {
      setStatus(`清洗失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-rose-300/40 bg-rose-300/10 px-2.5 py-[5px] text-[11px] font-medium text-rose-100 hover:bg-rose-300/20">
        清洗口播案例库
      </button>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      {status && <span className="max-w-[250px] truncate text-[10px] text-ink-faint" title={status}>{status}</span>}
    </span>
  );
}
