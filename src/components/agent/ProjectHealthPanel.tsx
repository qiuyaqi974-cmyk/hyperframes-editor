import { useMemo, useState } from 'react';
import { analyzeProjectHealth, applySafeHealthFixes, type ProjectHealthIssue } from '@/lib/projectHealth';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';

const GROUPS = [
  { key: 'blocker' as const, label: '必须修复', tone: 'text-red-200', dot: 'bg-red-400' },
  { key: 'warning' as const, label: '制作风险', tone: 'text-amber-200', dot: 'bg-amber-300' },
  { key: 'director' as const, label: '导演一致性', tone: 'text-violet-200', dot: 'bg-violet-300' },
];

export default function ProjectHealthPanel({ onClose }: { onClose?: () => void }) {
  const blocks = useEditorStore((state) => state.blocks);
  const assets = useEditorStore((state) => state.assets);
  const sourceMedia = useEditorStore((state) => state.sourceMedia);
  const scenes = useEditorStore((state) => state.scenes);
  const reviews = useEditorStore((state) => state.reviews);
  const narration = useEditorStore((state) => state.narration);
  const director = useEditorStore((state) => state.director);
  const canvas = useEditorStore((state) => state.canvas);
  const projectName = useEditorStore((state) => state.projectName);
  const themeId = useEditorStore((state) => state.themeId);
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');

  const snapshot = useMemo(() => ({
    app: 'hyperframes-editor' as const,
    version: 4,
    themeId,
    projectName,
    canvas,
    blocks,
    assets,
    sourceMedia,
    narration,
    scenes,
    reviews,
    director,
    updatedAt: new Date().toISOString(),
  }), [assets, blocks, canvas, director, narration, projectName, reviews, scenes, sourceMedia, themeId]);
  const report = useMemo(() => analyzeProjectHealth(snapshot), [snapshot]);

  const locate = (issue: ProjectHealthIssue) => {
    const target = issue.blockId
      ? blocks.find((block) => block.id === issue.blockId)
      : issue.sceneId
        ? blocks.find((block) => block.sceneId === issue.sceneId)
        : undefined;
    const scene = issue.sceneId ? scenes.find((item) => item.id === issue.sceneId) : undefined;
    const ui = useUIStore.getState();
    ui.pause();
    ui.setTime(issue.time ?? target?.start ?? scene?.start ?? 0);
    ui.selectBlock(target?.id ?? null);
    onClose?.();
  };

  const fixSafeIssues = () => {
    const result = applySafeHealthFixes(snapshot);
    if (!result.fixedCount) return;
    useEditorStore.getState().importSnapshot(result.snapshot);
    setMessage(`已安全修复 ${result.fixedCount} 处字幕或配音时长问题。`);
  };

  const badge = report.status === 'blocked'
    ? { label: `${report.blockers.length} 个阻断`, style: 'border-red-400/30 bg-red-400/10 text-red-200' }
    : report.status === 'risky'
      ? { label: `${report.issues.length} 项待检查`, style: 'border-amber-300/30 bg-amber-300/10 text-amber-100' }
      : { label: '可交付', style: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100' };

  return (
    <section className="rounded-lg border border-stroke bg-panel-2/70 p-2.5" aria-label="项目体检">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left">
        <span className="text-[11px] font-semibold text-ink">项目体检</span>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] ${badge.style}`}>{badge.label}</span>
        <span className="ml-auto text-[11px] text-ink-faint">{expanded ? '−' : '+'}</span>
      </button>
      <div className="mt-1.5 flex gap-3 text-[9.5px] text-ink-faint">
        <span>阻断 {report.blockers.length}</span>
        <span>风险 {report.warnings.length}</span>
        <span>导演 {report.directorIssues.length}</span>
      </div>

      {expanded && (
        <div className="mt-2.5 space-y-3 border-t border-stroke pt-2.5">
          {report.status === 'ready' && <p className="text-[10.5px] leading-relaxed text-emerald-200">时间轴、媒体和导演约束均已通过，可以进入最终交付。</p>}
          {GROUPS.map((group) => {
            const issues = report.issues.filter((issue) => issue.severity === group.key);
            if (!issues.length) return null;
            return (
              <div key={group.key}>
                <div className={`mb-1 text-[9.5px] font-semibold ${group.tone}`}>{group.label} · {issues.length}</div>
                <div className="space-y-1">
                  {issues.map((issue) => (
                    <button key={issue.id} type="button" onClick={() => locate(issue)} className="group flex w-full gap-2 rounded-md border border-transparent px-1.5 py-1.5 text-left hover:border-stroke hover:bg-panel-3">
                      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${group.dot}`} />
                      <span className="min-w-0">
                        <span className="block text-[10.5px] font-medium text-ink-dim group-hover:text-ink">{issue.title}</span>
                        <span className="mt-0.5 block text-[9.5px] leading-relaxed text-ink-faint">{issue.detail}</span>
                      </span>
                      {(issue.blockId || issue.sceneId) && <span className="ml-auto shrink-0 text-[9px] text-cyan-300 opacity-0 group-hover:opacity-100">定位</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {report.fixableCount > 0 && (
            <button type="button" onClick={fixSafeIssues} className="w-full rounded-md border border-cyan-300/35 bg-cyan-300/10 px-2.5 py-1.5 text-[10.5px] font-medium text-cyan-100 hover:bg-cyan-300/20">
              一键安全修复 {report.fixableCount} 项
            </button>
          )}
          {message && <p className="text-[9.5px] leading-relaxed text-emerald-200">{message}</p>}
          {report.blockers.length > 0 && <p className="text-[9.5px] leading-relaxed text-ink-faint">阻断项会暂停 MP4 和剪辑交付包导出；HTML 预览仍可使用。</p>}
        </div>
      )}
    </section>
  );
}
