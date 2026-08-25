import { useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';
import { BLOCK_COLOR } from '@/lib/blockFactory';

/**
 * 图层面板（多层级管理）。
 *
 * - 列表按 layer 降序（顶部 = 最前 = 最高 layer），与画布叠加顺序一致；
 * - 拖拽整行即可重排层级（HTML5 DnD，不引入额外依赖）；
 * - 每行可切换「可见 / 锁定」，状态与画布实时联动。
 *
 * 选中、可见、锁定都复用 store 已有字段与 action，不新增数据模型。
 */
export default function LayersPanel() {
  const blocks = useEditorStore((s) => s.blocks);
  const setLayerOrder = useEditorStore((s) => s.setLayerOrder);
  const toggleVisible = useEditorStore((s) => s.toggleVisible);
  const toggleLocked = useEditorStore((s) => s.toggleLocked);
  const removeBlock = useEditorStore((s) => s.removeBlock);
  const selectedId = useUIStore((s) => s.selectedId);
  const selectBlock = useUIStore((s) => s.selectBlock);

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const orderedAll = [...blocks].sort((a, b) => b.layer - a.layer);
  const ordered = orderedAll.filter((block) => block.source !== 'srt');
  const srtBlocks = orderedAll.filter((block) => block.source === 'srt');

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = orderedAll.map((b) => b.id).filter((id) => id !== dragId);
    const ti = ids.indexOf(targetId);
    if (ti < 0) {
      setDragId(null);
      setOverId(null);
      return;
    }
    ids.splice(ti, 0, dragId);
    setLayerOrder(ids);
    setDragId(null);
    setOverId(null);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto border-b border-stroke px-3 py-3">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
        Layers
        <span className="rounded bg-panel-3 px-1.5 py-[1px] font-mono text-[9.5px] text-ink-faint">
          {ordered.length}{srtBlocks.length ? ` + ${srtBlocks.length} 字幕` : ''}
        </span>
        <span className="ml-auto font-normal normal-case tracking-normal text-[9.5px] text-ink-faint/70">
          拖拽排序
        </span>
      </h2>

      {ordered.length === 0 && srtBlocks.length === 0 ? (
        <p className="px-1 text-[11px] text-ink-faint">还没有积木</p>
      ) : (
        <div className="space-y-1">
          {srtBlocks.length > 0 && (
            <button
              onClick={() => selectBlock(srtBlocks[0].id)}
              className="flex w-full items-center gap-2 rounded-md bg-subtitle/10 px-2 py-[7px] text-left text-[11.5px] text-subtitle hover:bg-subtitle/15"
            >
              <span className="h-[8px] w-[8px] rounded-sm bg-subtitle" />
              <span className="flex-1">SRT 自动字幕</span>
              <span className="font-mono text-[10px] opacity-70">{srtBlocks.length} 条</span>
            </button>
          )}
          {ordered.map((b) => {
            const active = b.id === selectedId;
            const isDrag = dragId === b.id;
            const isOver = overId === b.id && dragId !== b.id;
            return (
              <div
                key={b.id}
                draggable
                onDragStart={() => setDragId(b.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverId(b.id);
                }}
                onDrop={() => handleDrop(b.id)}
                onClick={() => selectBlock(b.id)}
                className={`group flex cursor-grab items-center gap-1.5 rounded-md px-2 py-[6px] text-[12px] transition-colors active:cursor-grabbing ${
                  active
                    ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent/50'
                    : 'text-ink-dim hover:bg-white/5'
                } ${isDrag ? 'opacity-40' : ''} ${isOver ? 'ring-1 ring-inset ring-accent/70' : ''}`}
              >
                {/* 拖拽把手 */}
                <span className="cursor-grab select-none text-[11px] leading-none text-ink-faint/60 group-hover:text-ink-dim">
                  ⠿
                </span>
                <span
                  className="h-[8px] w-[8px] shrink-0 rounded-sm"
                  style={{ background: BLOCK_COLOR[b.type] }}
                />
                <span
                  className={`min-w-0 flex-1 truncate ${
                    b.visible ? '' : 'text-ink-faint line-through opacity-60'
                  }`}
                >
                  {b.name}
                </span>

                {/* 可见切换 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVisible(b.id);
                  }}
                  title={b.visible ? '隐藏' : '显示'}
                  className={`shrink-0 rounded p-[2px] hover:bg-white/10 ${
                    b.visible ? 'text-ink-dim' : 'text-ink-faint'
                  }`}
                >
                  {b.visible ? <EyeIcon /> : <EyeOffIcon />}
                </button>

                {/* 锁定切换 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLocked(b.id);
                  }}
                  title={b.locked ? '解锁' : '锁定'}
                  className={`shrink-0 rounded p-[2px] hover:bg-white/10 ${
                    b.locked ? 'text-accent' : 'text-ink-faint'
                  }`}
                >
                  {b.locked ? <LockIcon /> : <UnlockIcon />}
                </button>

                {/* 删除 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBlock(b.id);
                  }}
                  title="删除"
                  className="shrink-0 rounded p-[2px] text-ink-faint opacity-0 transition-opacity hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- 行内图标 ---------- */

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-3.1 3.9M6.2 6.2A13.2 13.2 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 3.4-.6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </svg>
  );
}
