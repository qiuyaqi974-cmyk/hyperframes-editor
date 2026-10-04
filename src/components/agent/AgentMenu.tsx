import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const AgentWorkspace = lazy(() => import('./AgentWorkspace'));

/** 轻量入口：只有用户打开工作台时，才下载导演、长素材、RC 与高级工具代码。 */
export default function AgentMenu() {
  const [open, setOpen] = useState(false);
  const [releaseSignal, setReleaseSignal] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const openRelease = () => {
      setOpen(true);
      setReleaseSignal((value) => value + 1);
    };
    window.addEventListener('hyperframes:open-release', openRelease);
    return () => window.removeEventListener('hyperframes:open-release', openRelease);
  }, []);

  return <div ref={rootRef} className="relative shrink-0">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={`rounded-md border px-2.5 py-[5px] text-[11px] font-medium transition-colors ${open ? 'border-cyan-300/60 bg-cyan-300/20 text-cyan-50' : 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20'}`}>
      AI 助手 {open ? '▴' : '▾'}
    </button>
    {open && createPortal(<div ref={panelRef} aria-label="AI 导演工作台" className="fixed right-4 top-12 z-50 flex max-h-[calc(100vh-64px)] w-[380px] flex-col gap-3 overflow-y-auto rounded-xl border border-stroke bg-panel p-3 shadow-2xl">
      <Suspense fallback={<div role="status" className="rounded border border-stroke p-3 text-[10px] text-ink-faint">正在加载 AI 导演工作台…</div>}>
        <AgentWorkspace onClose={() => setOpen(false)} releaseSignal={releaseSignal} />
      </Suspense>
    </div>, document.body)}
  </div>;
}
