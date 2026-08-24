import { useRef, useState } from 'react';
import { refineDirectorTemplates } from '@/lib/contentDirector/templateRefiner';

export default function DirectorTemplateRefinerLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const templates = refineDirectorTemplates(parsed);
      const blob = new Blob([JSON.stringify(templates, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'director-templates-v2.json';
      anchor.click();
      URL.revokeObjectURL(url);
      console.log('导演模板升级完成：', templates.length, 'templates');
      setStatus(`导演模板升级完成：${templates.length} templates`);
    } catch (error) {
      setStatus(`升级失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-amber-300/40 bg-amber-300/10 px-2.5 py-[5px] text-[11px] font-medium text-amber-100 hover:bg-amber-300/20">
        升级导演模板
      </button>
      <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
      {status && <span className="text-[10px] text-ink-faint">{status}</span>}
    </span>
  );
}
