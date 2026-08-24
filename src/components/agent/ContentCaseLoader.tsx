import { useRef, useState } from 'react';
import { analyzeCases } from '@/lib/contentIntelligence/caseAnalyzer';
import { importContentCases } from '@/lib/contentIntelligence/excelImporter';

export default function ContentCaseLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const cases = await importContentCases(file);
      const patterns = analyzeCases(cases);
      const blob = new Blob([JSON.stringify(patterns, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'content-patterns.json';
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(`导入成功：${cases.length} 个案例，生成 ${patterns.length} 个内容模式`);
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-fuchsia-300/40 bg-fuchsia-300/10 px-2.5 py-[5px] text-[11px] font-medium text-fuchsia-100 hover:bg-fuchsia-300/20"
      >
        导入口播案例库
      </button>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      {status && <span className="max-w-[180px] truncate text-[10px] text-ink-faint" title={status}>{status}</span>}
    </span>
  );
}
