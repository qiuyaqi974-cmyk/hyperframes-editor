import { useRef, useState } from 'react';
import { extractDirectorTemplates } from '@/lib/contentDirector/templateExtractor';

export default function DirectorTemplateLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const patterns = JSON.parse(await file.text()) as unknown;
      const templates = extractDirectorTemplates(Array.isArray(patterns) ? patterns : []);
      const blob = new Blob([JSON.stringify(templates, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'director-templates.json';
      anchor.click();
      URL.revokeObjectURL(url);
      console.log('导演模板生成完成：', templates.length, 'templates');
      setStatus(`导演模板生成完成：${templates.length} templates`);
    } catch (error) {
      setStatus(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-lime-300/40 bg-lime-300/10 px-2.5 py-[5px] text-[11px] font-medium text-lime-100 hover:bg-lime-300/20">
        生成导演模板
      </button>
      <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
      {status && <span className="text-[10px] text-ink-faint">{status}</span>}
    </span>
  );
}
