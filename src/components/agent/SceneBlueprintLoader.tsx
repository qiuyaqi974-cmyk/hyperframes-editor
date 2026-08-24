import { useRef, useState } from 'react';
import { generateSceneBlueprints } from '@/lib/sceneBlueprint/blueprintGenerator';

export default function SceneBlueprintLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const blueprints = generateSceneBlueprints(parsed);
      const blob = new Blob([JSON.stringify(blueprints, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'scene-blueprints.json';
      anchor.click();
      URL.revokeObjectURL(url);
      console.log('Scene Blueprint 生成完成：', blueprints.length, 'blueprints');
      setStatus(`生成完成：${blueprints.length} 个蓝图`);
    } catch (error) {
      setStatus(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-orange-300/40 bg-orange-300/10 px-2.5 py-[5px] text-[11px] font-medium text-orange-100 hover:bg-orange-300/20">
        生成Scene Blueprint
      </button>
      <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
      {status && <span className="text-[10px] text-ink-faint">{status}</span>}
    </span>
  );
}
