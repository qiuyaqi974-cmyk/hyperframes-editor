import { editorHistory } from '@/store/editorStore';
import { useEditorHistoryStore } from '@/store/editorHistory';

export default function EditorHistoryControls() {
  const undoCount = useEditorHistoryStore((s) => s.undoCount);
  const redoCount = useEditorHistoryStore((s) => s.redoCount);
  const message = useEditorHistoryStore((s) => s.message);
  return <div className="flex items-center gap-1 text-[10px] text-ink-dim" aria-label="编辑历史">
    <button type="button" onClick={() => editorHistory.undo()} disabled={!undoCount} title="撤销 Ctrl+Z；输入框保留文本撤销" className="rounded border border-stroke px-2 py-1 disabled:opacity-35">撤销 {undoCount || ''}</button>
    <button type="button" onClick={() => editorHistory.redo()} disabled={!redoCount} title="重做 Ctrl+Shift+Z / Ctrl+Y" className="rounded border border-stroke px-2 py-1 disabled:opacity-35">重做 {redoCount || ''}</button>
    <span role="status" className="sr-only">{message}</span>
    {message && <span title={message} className="max-w-24 truncate text-amber-200">需重新确认</span>}
  </div>;
}
