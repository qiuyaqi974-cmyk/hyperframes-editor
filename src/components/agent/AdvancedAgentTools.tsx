import type { ReactNode } from 'react';
import { ContentPlanButton } from './QuickGenerateButtons';
import ScenePlanLoader from './ScenePlanLoader';
import ProductVideoLoader from './ProductVideoLoader';
import ContentCaseLoader from './ContentCaseLoader';
import ContentDatasetCleanerLoader from './ContentDatasetCleanerLoader';
import AssetInsightExportButton from './AssetInsightExportButton';
import DirectorTemplateLoader from './DirectorTemplateLoader';
import DirectorTemplateRefinerLoader from './DirectorTemplateRefinerLoader';
import SceneBlueprintLoader from './SceneBlueprintLoader';
import DirectorAgentLoader from './DirectorAgentLoader';
import DirectorPlanAdapterLoader from './DirectorPlanAdapterLoader';
import AssetResolverLoader from './AssetResolverLoader';
import BatchVoiceoverPanel from './BatchVoiceoverPanel';

const groups: { label: string; items: ReactNode[] }[] = [
  { label: '声音与时间轴', items: [<BatchVoiceoverPanel key="batch-voice" />] },
  { label: '内容洞察', items: [<ContentCaseLoader key="case" />, <ContentDatasetCleanerLoader key="cleaner" />, <AssetInsightExportButton key="insight" />] },
  { label: '导演实验室', items: [<ContentPlanButton key="plan" />, <ScenePlanLoader key="scene-plan" />, <ProductVideoLoader key="product-video" />, <DirectorTemplateLoader key="template" />, <DirectorTemplateRefinerLoader key="refiner" />, <SceneBlueprintLoader key="blueprint" />, <DirectorAgentLoader key="director" />, <DirectorPlanAdapterLoader key="adapter" />, <AssetResolverLoader key="resolver" />] },
];

export default function AdvancedAgentTools() {
  return <div className="mt-2 space-y-3">{groups.map((group) => <div key={group.label}>
    <div className="mb-1.5 text-[10px] font-semibold text-ink-faint">{group.label}</div>
    <div className="flex flex-col items-stretch gap-1.5">{group.items}</div>
  </div>)}</div>;
}
