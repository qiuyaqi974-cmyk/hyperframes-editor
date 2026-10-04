import { useState } from 'react';
import { fileToAsset, pickFiles } from '@/lib/assets';
import { projectDuration } from '@/store/projectDuration';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';
import { AgentGenerateButton } from './QuickGenerateButtons';
import DeliveryPackageButton from './DeliveryPackageButton';
import ProductProjectLoader from './ProductProjectLoader';
import VoiceoverPipelineLoader from './VoiceoverPipelineLoader';
import WebCaptureLoader from './WebCaptureLoader';
import BatchVoiceoverPanel from './BatchVoiceoverPanel';

interface ProductionFlowPanelProps {
  onClose: () => void;
}

interface FlowStepProps {
  index: number;
  title: string;
  summary: string;
  complete: boolean;
  current: boolean;
  children?: React.ReactNode;
}

function FlowStep({ index, title, summary, complete, current, children }: FlowStepProps) {
  return (
    <section className={`rounded-lg border p-2.5 ${current ? 'border-cyan-300/50 bg-cyan-300/[0.07]' : 'border-stroke bg-panel-2/70'}`}>
      <div className="flex items-start gap-2.5">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${complete ? 'bg-emerald-400 text-[#102018]' : current ? 'bg-cyan-300 text-[#102028]' : 'bg-panel-3 text-ink-faint'}`}>
          {complete ? '✓' : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] font-semibold text-ink">{title}</span>
            {current && <span className="rounded bg-cyan-300/15 px-1.5 py-0.5 text-[9px] text-cyan-100">下一步</span>}
          </span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-faint">{summary}</span>
        </span>
      </div>
      {current && children && <div className="mt-2 space-y-1.5 border-t border-stroke/70 pt-2">{children}</div>}
    </section>
  );
}

export default function ProductionFlowPanel({ onClose }: ProductionFlowPanelProps) {
  const blocks = useEditorStore((state) => state.blocks);
  const assets = useEditorStore((state) => state.assets);
  const scenes = useEditorStore((state) => state.scenes);
  const narration = useEditorStore((state) => state.narration);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const voiceBlocks = blocks.filter((block) => block.type === 'voice');
  const generatedVoiceCount = voiceBlocks.filter((block) => block.props.generated && block.props.src).length;
  const hasStructure = scenes.length > 0 && blocks.length > 0;
  const hasAudio = voiceBlocks.length > 0
    ? generatedVoiceCount === voiceBlocks.length
    : Boolean(narration?.src);
  const visualSceneIds = new Set(
    blocks
      .filter((block) => block.sceneId && block.type !== 'voice' && block.type !== 'subtitle')
      .map((block) => block.sceneId as string),
  );
  const coveredScenes = scenes.filter((scene) => visualSceneIds.has(scene.id)).length;
  const hasVisuals = scenes.length > 0 && coveredScenes === scenes.length;
  const ready = hasStructure && hasAudio && hasVisuals;
  const completedCount = [hasStructure, hasAudio, hasVisuals, ready].filter(Boolean).length;
  const duration = blocks.length ? projectDuration({ blocks, scenes, narration }) : 0;
  const currentStep = !hasStructure ? 1 : !hasAudio ? 2 : !hasVisuals ? 3 : 4;

  const importAssets = async () => {
    if (busy) return;
    const files = await pickFiles('image/*,video/*');
    if (!files.length) return;
    setBusy(true);
    setStatus('正在读取素材…');
    let imported = 0;
    try {
      for (const file of files) {
        const asset = await fileToAsset(file);
        if (asset) {
          useEditorStore.getState().addAsset(asset);
          imported += 1;
        }
      }
      setStatus(`已导入 ${imported} 个素材。`);
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const matchAssets = () => {
    try {
      const result = useEditorStore.getState().autoMatchAssets();
      setStatus(`匹配 ${result.matched} 个场景；仍缺 ${result.unmatchedScenes} 个${result.lockedScenes ? `；跳过 ${result.lockedScenes} 个锁定场景` : ''}。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const reviewTimeline = () => {
    const ui = useUIStore.getState();
    ui.pause();
    ui.setTime(0);
    ui.selectBlock(blocks[0]?.id ?? null);
    onClose();
  };

  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-cyan-300/25 bg-gradient-to-br from-cyan-300/10 to-blue-400/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold text-cyan-50">AI 视频生产线</div>
            <div className="mt-0.5 text-[10px] text-cyan-100/60">按项目真实状态推荐下一步</div>
          </div>
          <span className="font-mono text-[11px] text-cyan-100">{completedCount}/4</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all" style={{ width: `${completedCount * 25}%` }} />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[9px] text-ink-faint">
          <span>{scenes.length} 场景</span>
          <span>{generatedVoiceCount || (narration ? 1 : 0)} 音轨</span>
          <span>{assets.length} 素材</span>
          <span>{duration.toFixed(1)} 秒</span>
        </div>
      </div>

      <FlowStep
        index={1}
        title="建立内容与时间轴"
        summary={hasStructure ? `${scenes.length} 个场景已经进入时间轴。` : '从最终口播稿、商品文件夹或一个主题开始。'}
        complete={hasStructure}
        current={currentStep === 1}
      >
        <VoiceoverPipelineLoader />
        <ProductProjectLoader />
        <AgentGenerateButton />
      </FlowStep>

      <FlowStep
        index={2}
        title="锁定声音节奏"
        summary={hasAudio ? `已有 ${generatedVoiceCount || 1} 条可播放音轨。` : voiceBlocks.length ? `有 ${voiceBlocks.length} 条旁白占位，但还没有生成音频。` : '以真实配音时长锁定镜头节奏。'}
        complete={hasAudio}
        current={currentStep === 2}
      >
        {!hasAudio && <p className="text-[10px] leading-relaxed text-amber-100/75">导入最终口播稿会生成配音、字幕和场景，并替换旧的占位旁白。</p>}
        <BatchVoiceoverPanel />
        <VoiceoverPipelineLoader />
      </FlowStep>

      <FlowStep
        index={3}
        title="补齐场景画面"
        summary={scenes.length === 0 ? '建立场景后，在这里补齐图片、视频或图形画面。' : hasVisuals ? `${coveredScenes}/${scenes.length} 个场景已有画面。` : `${coveredScenes}/${scenes.length} 个场景已有画面；素材库 ${assets.length} 项。`}
        complete={hasVisuals}
        current={currentStep === 3}
      >
        <button type="button" onClick={importAssets} disabled={busy} className="w-full rounded-md border border-lime-300/40 bg-lime-300/10 px-2.5 py-[6px] text-left text-[11px] font-medium text-lime-100 hover:bg-lime-300/20 disabled:opacity-50">
          {busy ? '正在导入素材…' : '批量导入图片 / 视频'}
        </button>
        <WebCaptureLoader />
        <button type="button" onClick={matchAssets} disabled={!assets.length || !scenes.length} className="w-full rounded-md border border-amber-300/40 bg-amber-300/10 px-2.5 py-[6px] text-left text-[11px] font-medium text-amber-100 hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-40">
          自动匹配素材到场景
        </button>
        {status && <p className="text-[10px] leading-relaxed text-ink-faint">{status}</p>}
      </FlowStep>

      <FlowStep
        index={4}
        title="人工校正并交付"
        summary={ready ? '结构、声音和画面已齐，可以检查节奏后交付。' : '完成前三步后检查画面、字幕和镜头节奏。'}
        complete={ready}
        current={currentStep === 4}
      >
        <button type="button" onClick={reviewTimeline} className="w-full rounded-md border border-blue-300/40 bg-blue-300/10 px-2.5 py-[6px] text-left text-[11px] font-medium text-blue-100 hover:bg-blue-300/20">
          回到画布，从头检查
        </button>
        <DeliveryPackageButton />
      </FlowStep>
    </div>
  );
}
