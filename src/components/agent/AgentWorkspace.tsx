import { lazy, Suspense, useState } from 'react';
import ProductionFlowPanel from './ProductionFlowPanel';
import DirectorDecisionPanel from './DirectorDecisionPanel';
import ProjectHealthPanel from './ProjectHealthPanel';
import ReleaseCandidatePanel from './ReleaseCandidatePanel';
import SourceMediaPanel from './SourceMediaPanel';
import SceneReviewPanel from './SceneReviewPanel';
import PostPublishFeedbackPanel from './PostPublishFeedbackPanel';
import PostPublishExperimentPanel from './PostPublishExperimentPanel';
import DirectorLearningLibraryPanel from './DirectorLearningLibraryPanel';
import ProjectArchivePanel from './ProjectArchivePanel';

const AdvancedAgentTools = lazy(() => import('./AdvancedAgentTools'));

export default function AgentWorkspace({ onClose, releaseSignal }: { onClose: () => void; releaseSignal: number }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return <>
    <DirectorDecisionPanel />
    <PostPublishFeedbackPanel />
    <PostPublishExperimentPanel />
    <DirectorLearningLibraryPanel />
    <ProjectArchivePanel />
    <SourceMediaPanel />
    <ProductionFlowPanel onClose={onClose} />
    <SceneReviewPanel />
    <ProjectHealthPanel onClose={onClose} />
    <ReleaseCandidatePanel onClose={onClose} openSignal={releaseSignal} />
    <div className="border-t border-stroke pt-2">
      <button type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((value) => !value)} className="flex w-full items-center justify-between rounded-md px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint hover:text-ink-dim">
        高级工具与实验入口 <span>{showAdvanced ? '−' : '+'}</span>
      </button>
      {showAdvanced && <Suspense fallback={<div role="status" className="mt-2 text-[9px] text-ink-faint">正在加载高级工具…</div>}><AdvancedAgentTools /></Suspense>}
    </div>
  </>;
}
