import { useEffect, useRef, useState } from 'react';
import { AgentGenerateButton, ContentPlanButton } from './QuickGenerateButtons';
import ScenePlanLoader from './ScenePlanLoader';
import ProductVideoLoader from './ProductVideoLoader';
import ProductProjectLoader from './ProductProjectLoader';
import ContentCaseLoader from './ContentCaseLoader';
import ContentDatasetCleanerLoader from './ContentDatasetCleanerLoader';
import AssetInsightExportButton from './AssetInsightExportButton';
import DirectorTemplateLoader from './DirectorTemplateLoader';
import DirectorTemplateRefinerLoader from './DirectorTemplateRefinerLoader';
import SceneBlueprintLoader from './SceneBlueprintLoader';
import DirectorAgentLoader from './DirectorAgentLoader';
import DirectorPlanAdapterLoader from './DirectorPlanAdapterLoader';
import AssetResolverLoader from './AssetResolverLoader';
import VoiceoverPipelineLoader from './VoiceoverPipelineLoader';
import WebCaptureLoader from './WebCaptureLoader';

/**
 * AI 助手菜单：把所有 Agent 能力收进一个下拉面板。
 *
 * 每个 Agent 功能仍是独立的 Loader 组件（各自带输入、状态与文件选择），
 * 这里只负责分组承载——以后新增 Agent 能力时在 GROUPS 里加一行即可，
 * 顶栏不再继续堆按钮。
 */
const GROUPS: { label: string; items: React.ReactNode[] }[] = [
  {
    label: '生成工程',
    items: [
      <AgentGenerateButton key="generate" />,
      <ContentPlanButton key="plan" />,
      <ScenePlanLoader key="scene-plan" />,
      <ProductVideoLoader key="product-video" />,
      <ProductProjectLoader key="product-project" />,
    ],
  },
  {
    label: '内容洞察',
    items: [
      <ContentCaseLoader key="case" />,
      <ContentDatasetCleanerLoader key="cleaner" />,
      <AssetInsightExportButton key="insight" />,
    ],
  },
  {
    label: '口播生产线',
    items: [
      <VoiceoverPipelineLoader key="voiceover" />,
      <WebCaptureLoader key="web-capture" />,
    ],
  },
  {
    label: '导演与模板',
    items: [
      <DirectorTemplateLoader key="template" />,
      <DirectorTemplateRefinerLoader key="refiner" />,
      <SceneBlueprintLoader key="blueprint" />,
      <DirectorAgentLoader key="director" />,
      <DirectorPlanAdapterLoader key="adapter" />,
      <AssetResolverLoader key="resolver" />,
    ],
  },
];

export default function AgentMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`rounded-md border px-2.5 py-[5px] text-[11px] font-medium transition-colors ${
          open
            ? 'border-cyan-300/60 bg-cyan-300/20 text-cyan-50'
            : 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20'
        }`}
      >
        AI 助手 {open ? '▴' : '▾'}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex max-h-[70vh] w-[300px] flex-col gap-3 overflow-y-auto rounded-lg border border-stroke bg-panel p-3 shadow-2xl">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                {group.label}
              </div>
              <div className="flex flex-col items-stretch gap-1.5">
                {group.items}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
