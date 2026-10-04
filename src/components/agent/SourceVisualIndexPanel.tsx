import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExternalMediaSource, SourceActionVisualEvidence, SourceActionVisualRefinementComparison, SourceEventMarkerKind } from '@/types';
import type { SourceVisualIndexResult } from '@/lib/sourceVisualIndex';
import { selectVisualAnalysisFrames, selectVisualRefinementBudget } from '@/lib/sourceVisualIndex';
import type { VisualUnderstandingAdjacentFrameDifference, VisualUnderstandingCapabilities, VisualUnderstandingCandidate, VisualUnderstandingDuplicateFrameGroup, VisualUnderstandingDuplicateFrameReview, VisualUnderstandingFrame, VisualUnderstandingFrameFingerprint, VisualUnderstandingPayloadSummary, VisualUnderstandingProviderCapability, VisualUnderstandingProviderProbe, VisualUnderstandingRequestRecord, VisualUnderstandingResult, VisualUnderstandingSequenceCandidate, VisualUnderstandingSessionBudget, VisualUnderstandingSessionUsage, VisualUnderstandingSimilarFramePair, VisualUnderstandingSimilarFrameReview, VisualUnderstandingTokenUsage, VisualUnderstandingTokenUsageBucket } from '@/lib/sourceVisualUnderstanding';
import { addVisualUnderstandingPerceptualHashes, addVisualUnderstandingTokenUsage, compareVisualUnderstandingAdjacentFrames, compareVisualUnderstandingSequences, createVisualUnderstandingRequestLog, duplicateVisualUnderstandingFrameGroups, fingerprintVisualUnderstandingFrames, planVisualUnderstandingCoverageSelection, previewVisualUnderstandingRepresentativeSelection, recommendVisualUnderstandingCoverageOption, similarVisualUnderstandingFramePairs, summarizeVisualUnderstandingCoverage, summarizeVisualUnderstandingPayload, verifyVisualUnderstandingRequestLog, visualUnderstandingBudgetViolations, visualUnderstandingTokenStop } from '@/lib/sourceVisualUnderstanding';
import { createActionEntry, actionShotLabels } from '@/lib/sourceActionIndex';
import { useEditorStore } from '@/store/editorStore';

interface Bridge {
  generateSourceVisualIndex: (path: string, maxFrames: number, interval: number) => Promise<SourceVisualIndexResult>;
  generateSourceVisualRefinement: (path: string, start: number, end: number, maxFrames: number) => Promise<SourceVisualIndexResult>;
  getSourceVisualUnderstandingCapabilities: () => Promise<VisualUnderstandingCapabilities>;
  probeSourceVisualUnderstandingProvider: (providerId: VisualUnderstandingProviderCapability['id']) => Promise<VisualUnderstandingProviderProbe>;
  analyzeSourceVisualFrames: (frames: VisualUnderstandingFrame[], providerId: VisualUnderstandingProviderCapability['id']) => Promise<VisualUnderstandingResult>;
}

type CandidateDraft = VisualUnderstandingCandidate & { reviewed: boolean; kind: SourceEventMarkerKind; saved: boolean; modelSnapshot: VisualUnderstandingCandidate };
type SequenceDraft = VisualUnderstandingSequenceCandidate & { reviewed: boolean; kind: SourceEventMarkerKind; saved: boolean; modelSnapshot: VisualUnderstandingSequenceCandidate; refinementComparison?: SourceActionVisualRefinementComparison; disagreementAcknowledged: boolean };
type RefinementState = { result?: SourceVisualIndexResult; confirmed: boolean; busy: boolean; error?: string };
type AnalysisContext = { providerId: string; provider: string; model: string; pass: 'initial' | 'refinement'; transcriptIncluded: boolean; payload: VisualUnderstandingPayloadSummary; sessionRequestNumber: number; requestId: string; requestedAt: string; requestFrames: VisualUnderstandingFrameFingerprint[]; duplicateFrameReview?: VisualUnderstandingDuplicateFrameReview; similarFrameReview?: VisualUnderstandingSimilarFrameReview; tokenUsage?: VisualUnderstandingTokenUsage };
type CoverageSupplementFrame = SourceVisualIndexResult['frames'][number] & { id: string; coverageBatchId: string; coverageRangeStart: number; coverageRangeEnd: number };
type CoverageDifferenceDecisionRecord = { id: string; batchId: string; batchNumber: number; firstTime: number; secondTime: number; hammingDistance: number; differenceRank: number; differenceCount: number; wasLargest: boolean; selectionReason?: string; addedImageCount: number; addedImageBytes: number; addedTranscriptCharacters: number; beforeLargestGapSeconds: number; afterLargestGapSeconds: number; selectedAt: string; status: 'applied' | 'undone'; undoneAt?: string };
const clock = (seconds: number) => {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(totalMilliseconds / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const base = `${minutes}:${String(wholeSeconds).padStart(2, '0')}`;
  return milliseconds ? `${base}.${String(milliseconds).padStart(3, '0')}` : base;
};
const bytesLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const sha256Text = async (value: string) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, '0')).join('');

export default function SourceVisualIndexPanel({ source, onSeek }: { source: ExternalMediaSource; onSeek: (time: number) => void }) {
  const [maxFrames, setMaxFrames] = useState(24);
  const [interval, setInterval] = useState(10);
  const [result, setResult] = useState<SourceVisualIndexResult>();
  const [coverageSupplements, setCoverageSupplements] = useState<CoverageSupplementFrame[]>([]);
  const [lastCoverageRecommendationSelection, setLastCoverageRecommendationSelection] = useState<{ batchId: string; batchNumber: number; addedIds: string[]; beforeLargestGapSeconds: number; afterLargestGapSeconds: number; addedImageBytes: number; addedTranscriptCharacters: number }>();
  const [lastCoverageDifferenceSelection, setLastCoverageDifferenceSelection] = useState<{ decisionId: string; batchId: string; batchNumber: number; addedIds: string[]; firstTime: number; secondTime: number; hammingDistance: number; differenceRank: number; differenceCount: number; wasLargest: boolean; selectionReason?: string; beforeLargestGapSeconds: number; afterLargestGapSeconds: number; addedImageBytes: number; addedTranscriptCharacters: number }>();
  const [coverageDifferenceDecisionHistory, setCoverageDifferenceDecisionHistory] = useState<CoverageDifferenceDecisionRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [capabilities, setCapabilities] = useState<VisualUnderstandingCapabilities>();
  const [providerId, setProviderId] = useState<VisualUnderstandingProviderCapability['id']>('openai');
  const [probe, setProbe] = useState<VisualUnderstandingProviderProbe>();
  const [uploadConfirmed, setUploadConfirmed] = useState(false);
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [candidates, setCandidates] = useState<CandidateDraft[]>([]);
  const [sequences, setSequences] = useState<SequenceDraft[]>([]);
  const [analyzedFrames, setAnalyzedFrames] = useState<VisualUnderstandingFrame[]>([]);
  const [analysisContext, setAnalysisContext] = useState<AnalysisContext>();
  const [refinements, setRefinements] = useState<Record<string, RefinementState>>({});
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [sessionUsage, setSessionUsage] = useState<VisualUnderstandingSessionUsage>({ requests: 0, imageCount: 0, imageBytes: 0, transcriptCharacters: 0 });
  const [sessionTokenUsage, setSessionTokenUsage] = useState<VisualUnderstandingTokenUsageBucket[]>([]);
  const [requestHistory, setRequestHistory] = useState<VisualUnderstandingRequestRecord[]>([]);
  const [requestLogVerification, setRequestLogVerification] = useState<{ ok: boolean; message: string }>();
  const [duplicateFrameApproval, setDuplicateFrameApproval] = useState<{ signature: string; groups: VisualUnderstandingDuplicateFrameGroup[]; confirmed: boolean; confirmedAt?: string }>();
  const [similarFrameApproval, setSimilarFrameApproval] = useState<{ signature: string; pairs: VisualUnderstandingSimilarFramePair[]; confirmed: boolean; confirmedAt?: string }>();
  const [similarityThreshold, setSimilarityThreshold] = useState(4);
  const [coverageGapTarget, setCoverageGapTarget] = useState(30);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [coverageBusy, setCoverageBusy] = useState(false);
  const [coverageBatchDifferences, setCoverageBatchDifferences] = useState<Record<string, { busy: boolean; pairs?: VisualUnderstandingAdjacentFrameDifference[]; error?: string }>>({});
  const [coverageDifferenceReasons, setCoverageDifferenceReasons] = useState<Record<string, string>>({});
  const [preflightSummary, setPreflightSummary] = useState('');
  const [sessionBudget, setSessionBudget] = useState<VisualUnderstandingSessionBudget>({ maxRequests: 10, maxImages: 60, maxImageBytes: 20 * 1024 * 1024, maxReportedTokensPerModel: 100000 });
  const request = useRef(0);
  const bridge = (window as Window & { hyperframesElectron?: Bridge }).hyperframesElectron;
  const updateSourceMedia = useEditorStore((state) => state.updateSourceMedia);

  useEffect(() => {
    let active = true;
    if (bridge) void bridge.getSourceVisualUnderstandingCapabilities().then((value) => { if (active) { setCapabilities(value); if (value.defaultProviderId) setProviderId(value.defaultProviderId); } });
    return () => { active = false; };
  }, [bridge]);
  useEffect(() => {
    request.current += 1; setResult(undefined); setCoverageSupplements([]); setCoverageBatchDifferences({}); setCoverageDifferenceReasons({}); setCoverageDifferenceDecisionHistory([]); setLastCoverageRecommendationSelection(undefined); setLastCoverageDifferenceSelection(undefined); setSelected(new Set()); setCandidates([]); setSequences([]); setAnalyzedFrames([]); setAnalysisContext(undefined); setRefinements({}); setDuplicateFrameApproval(undefined); setSimilarFrameApproval(undefined); setPreflightSummary(''); setPreflightBusy(false); setCoverageBusy(false); setUploadConfirmed(false); setProbe(undefined); setError(''); setBusy(false); setAnalyzing(false);
  }, [source.id, source.path, source.size]);
  useEffect(() => () => { request.current += 1; }, []);

  const indexedFrames = useMemo(() => [
    ...(result?.frames ?? []).map((frame, index) => ({ ...frame, id: `frame-${index + 1}` })),
    ...coverageSupplements,
  ].sort((first, second) => first.time - second.time), [result, coverageSupplements]);
  const providerOptions = capabilities?.providers ?? [];
  const selectedProvider = providerOptions.find((provider) => provider.id === providerId);
  const transcriptFor = (from: number, to: number) => (source.transcript ?? []).filter((segment) => segment.end > from && segment.start < to)
    .slice(0, 8).map((segment) => segment.text).join(' / ').slice(0, 4000);
  const analysisTranscriptFor = (from: number, to: number) => includeTranscript ? transcriptFor(from, to) : '';
  const selectedAnalysisFrames = () => indexedFrames.filter((frame) => selected.has(frame.id)).map((frame) => ({
    id: frame.id, time: frame.time, windowStart: frame.windowStart, windowEnd: frame.windowEnd, image: frame.image,
    transcript: analysisTranscriptFor(frame.windowStart, frame.windowEnd),
  }));
  const selectedPayload = summarizeVisualUnderstandingPayload(selectedAnalysisFrames());
  const selectedCoverage = summarizeVisualUnderstandingCoverage(indexedFrames.filter((frame) => selected.has(frame.id)), source.duration);
  const coverageSuggestion = indexedFrames.filter((frame) => !selected.has(frame.id) && frame.time > selectedCoverage.largestGap.start && frame.time < selectedCoverage.largestGap.end)
    .sort((first, second) => Math.abs(first.time - (selectedCoverage.largestGap.start + selectedCoverage.largestGap.end) / 2) - Math.abs(second.time - (selectedCoverage.largestGap.start + selectedCoverage.largestGap.end) / 2))[0];
  const remainingImageBudget = Math.max(0, sessionBudget.maxImages - sessionUsage.imageCount);
  const remainingImageByteBudget = Math.max(0, sessionBudget.maxImageBytes - sessionUsage.imageBytes);
  const remainingRequestBudget = Math.max(0, sessionBudget.maxRequests - sessionUsage.requests);
  const currentModelTokenStop = selectedProvider ? visualUnderstandingTokenStop(sessionTokenUsage, selectedProvider.id, selectedProvider.model, sessionBudget.maxReportedTokensPerModel) : '';
  const providerReadinessBlock = !selectedProvider
    ? '当前没有可用的视觉模型提供方。'
    : !selectedProvider.available
      ? selectedProvider.configurationError || `${selectedProvider.provider} / ${selectedProvider.model || '未配置模型'} 当前不可用。`
      : selectedProvider.local && probe?.providerId === selectedProvider.id && (!probe.ok || !probe.modelFound)
        ? probe.message || `${selectedProvider.provider} / ${selectedProvider.model} 最近一次本机探测未通过。`
        : '';
  const suggestedFrameCount = Math.min(12, remainingImageBudget, indexedFrames.length);
  const coveragePlan = indexedFrames.length && suggestedFrameCount > 0
    ? planVisualUnderstandingCoverageSelection(indexedFrames, [...selected], source.duration, Math.max(1, suggestedFrameCount))
    : undefined;
  const coverageTargetPlan = indexedFrames.length && suggestedFrameCount > 0
    ? planVisualUnderstandingCoverageSelection(indexedFrames, [...selected], source.duration, Math.max(1, suggestedFrameCount), coverageGapTarget)
    : undefined;
  const coveragePayloadFor = (frameIds: string[]) => summarizeVisualUnderstandingPayload(indexedFrames.filter((frame) => frameIds.includes(frame.id)).map((frame) => ({
    id: frame.id, time: frame.time, windowStart: frame.windowStart, windowEnd: frame.windowEnd, image: frame.image,
    transcript: analysisTranscriptFor(frame.windowStart, frame.windowEnd),
  })));
  const coveragePlanPayload = coveragePlan ? coveragePayloadFor(coveragePlan.selectedIds) : undefined;
  const coverageTargetPlanPayload = coverageTargetPlan ? coveragePayloadFor(coverageTargetPlan.selectedIds) : undefined;
  const coverageSupplementBatches = coverageSupplements.reduce<Array<{ id: string; start: number; end: number; frames: CoverageSupplementFrame[] }>>((batches, frame) => {
    const batch = batches.find((item) => item.id === frame.coverageBatchId);
    if (batch) batch.frames.push(frame);
    else batches.push({ id: frame.coverageBatchId, start: frame.coverageRangeStart, end: frame.coverageRangeEnd, frames: [frame] });
    return batches;
  }, []);
  const coverageSupplementBatchPreview = (frames: CoverageSupplementFrame[]) => {
    const frameIds = new Set(frames.map((frame) => frame.id));
    const selectedInBatch = [...selected].filter((id) => frameIds.has(id)).length;
    const mergedIds = [...new Set([...selected, ...frameIds])];
    if (mergedIds.length > 12) return { selectedInBatch, mergedIds, overLimit: true as const };
    const payload = coveragePayloadFor(mergedIds);
    const coverage = summarizeVisualUnderstandingCoverage(indexedFrames.filter((frame) => mergedIds.includes(frame.id)), source.duration);
    return {
      selectedInBatch,
      mergedIds,
      overLimit: false as const,
      addedImageCount: mergedIds.length - selected.size,
      overSessionImageBudget: mergedIds.length - selected.size > remainingImageBudget,
      addedImageBytes: payload.imageBytes - selectedPayload.imageBytes,
      overSessionImageByteBudget: payload.imageBytes - selectedPayload.imageBytes > remainingImageByteBudget,
      addedTranscriptCharacters: payload.transcriptCharacters - selectedPayload.transcriptCharacters,
      largestGapSeconds: coverage.largestGap.seconds,
    };
  };
  const imageBudgetEligibleCoverageSupplementBatch = recommendVisualUnderstandingCoverageOption(selectedCoverage.largestGap.seconds, coverageSupplementBatches.flatMap((batch) => {
    const preview = coverageSupplementBatchPreview(batch.frames);
    return preview.overLimit || preview.overSessionImageBudget || preview.overSessionImageByteBudget ? [] : [{ id: batch.id, resultingLargestGapSeconds: preview.largestGapSeconds, addedImageCount: preview.addedImageCount, addedImageBytes: preview.addedImageBytes }];
  }));
  const recommendedCoverageSupplementBatch = !providerReadinessBlock && remainingRequestBudget > 0 && !currentModelTokenStop ? imageBudgetEligibleCoverageSupplementBatch : undefined;
  const improvingCoverageSupplementOverBudget = coverageSupplementBatches.flatMap((batch) => {
    const preview = coverageSupplementBatchPreview(batch.frames);
    return preview.overLimit || (!preview.overSessionImageBudget && !preview.overSessionImageByteBudget) || preview.largestGapSeconds >= selectedCoverage.largestGap.seconds - 0.05 ? [] : [{ batch, preview }];
  })
    .sort((first, second) => first.preview.largestGapSeconds - second.preview.largestGapSeconds || first.preview.addedImageCount - second.preview.addedImageCount)[0];
  const recommendedCoverageSupplementBatchIndex = recommendedCoverageSupplementBatch
    ? coverageSupplementBatches.findIndex((batch) => batch.id === recommendedCoverageSupplementBatch.id)
    : -1;
  const coverageTargetStatus = selected.size < 1 ? undefined
    : selectedCoverage.largestGap.seconds <= coverageGapTarget
      ? { met: true, text: `当前 ${selectedCoverage.largestGap.seconds.toFixed(1)} 秒，已达到 ${coverageGapTarget} 秒目标。` }
      : coverageTargetPlan?.addedIds.length
        ? { met: coverageTargetPlan.after.largestGap.seconds <= coverageGapTarget, text: coverageTargetPlan.after.largestGap.seconds <= coverageGapTarget
          ? `预计补选 ${coverageTargetPlan.addedIds.length} 张后可达到 ${coverageGapTarget} 秒目标。`
          : `当前计划补选 ${coverageTargetPlan.addedIds.length} 张后仍为 ${coverageTargetPlan.after.largestGap.seconds.toFixed(1)} 秒，无法达到 ${coverageGapTarget} 秒目标。` }
        : { met: false, text: indexedFrames.length <= selected.size
          ? `当前 ${selectedCoverage.largestGap.seconds.toFixed(1)} 秒，未达到 ${coverageGapTarget} 秒目标；本地索引中没有更多可补选代表帧。`
          : suggestedFrameCount <= selected.size
            ? `当前 ${selectedCoverage.largestGap.seconds.toFixed(1)} 秒，未达到 ${coverageGapTarget} 秒目标；当前会话剩余图片额度不足。`
            : `当前 ${selectedCoverage.largestGap.seconds.toFixed(1)} 秒，未达到 ${coverageGapTarget} 秒目标；现有代表帧无法进一步缩小空档。` };

  const generate = async () => {
    if (!bridge || busy) return;
    const serial = ++request.current;
    setBusy(true); setResult(undefined); setCoverageSupplements([]); setCoverageBatchDifferences({}); setCoverageDifferenceReasons({}); setCoverageDifferenceDecisionHistory([]); setLastCoverageRecommendationSelection(undefined); setLastCoverageDifferenceSelection(undefined); setSelected(new Set()); setCandidates([]); setSequences([]); setAnalyzedFrames([]); setAnalysisContext(undefined); setRefinements({}); setDuplicateFrameApproval(undefined); setSimilarFrameApproval(undefined); setPreflightSummary(''); setUploadConfirmed(false); setError('');
    try {
      const next = await bridge.generateSourceVisualIndex(source.path, maxFrames, interval);
      if (serial === request.current) setResult(next);
    } catch (cause) { if (serial === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (serial === request.current) setBusy(false); }
  };

  const inspectFramesLocally = async (frames: VisualUnderstandingFrame[]) => {
    let fingerprints = await fingerprintVisualUnderstandingFrames(frames);
    fingerprints = await addVisualUnderstandingPerceptualHashes(frames, fingerprints);
    return {
      fingerprints,
      duplicateGroups: duplicateVisualUnderstandingFrameGroups(fingerprints),
      duplicateSignature: fingerprints.map((frame) => `${frame.id}:${frame.time}:${frame.sha256}`).join('|'),
      similarPairs: similarVisualUnderstandingFramePairs(fingerprints, similarityThreshold),
      similarSignature: fingerprints.map((frame) => `${frame.id}:${frame.time}:${frame.sha256}:${frame.perceptualHash}`).join('|'),
    };
  };

  const preflightSelectedFrames = async () => {
    if (preflightBusy || busy || analyzing || selected.size < 1) return;
    const serial = ++request.current;
    setPreflightBusy(true); setPreflightSummary(''); setError('');
    try {
      const inspection = await inspectFramesLocally(selectedAnalysisFrames());
      if (serial !== request.current) return;
      setDuplicateFrameApproval(inspection.duplicateGroups.length ? { signature: inspection.duplicateSignature, groups: inspection.duplicateGroups, confirmed: false } : undefined);
      setSimilarFrameApproval(inspection.similarPairs.length ? { signature: inspection.similarSignature, pairs: inspection.similarPairs, confirmed: false } : undefined);
      setPreflightSummary(inspection.duplicateGroups.length || inspection.similarPairs.length
        ? `本地预检完成：发现 ${inspection.duplicateGroups.length} 组完全重复、${inspection.similarPairs.length} 组高度相似截图；尚未发送任何图片。`
        : '本地预检完成：未发现完全重复或当前阈值内的高度相似截图；尚未发送任何图片。');
    } catch (cause) { if (serial === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (serial === request.current) setPreflightBusy(false); }
  };

  const generateCoverageSupplements = async () => {
    if (!bridge || coverageBusy || busy || analyzing || selected.size < 1 || selectedCoverage.largestGap.seconds < 0.2 || remainingImageBudget < 1) return;
    const serial = ++request.current;
    const frameCount = Math.min(6, Math.max(2, remainingImageBudget));
    const { start, end } = selectedCoverage.largestGap;
    setCoverageBusy(true); setError('');
    try {
      const next = await bridge.generateSourceVisualRefinement(source.path, start, end, frameCount);
      if (serial !== request.current) return;
      const existingTimes = new Set(indexedFrames.map((frame) => frame.time.toFixed(3)));
      const coverageBatchId = globalThis.crypto.randomUUID();
      const additions = next.frames.filter((frame) => !existingTimes.has(frame.time.toFixed(3))).map((frame, index) => ({ ...frame, id: `coverage-gap-${coverageBatchId}-${index + 1}`, coverageBatchId, coverageRangeStart: start, coverageRangeEnd: end }));
      setCoverageSupplements((current) => [...current, ...additions]);
      setUploadConfirmed(false); setCandidates([]); setSequences([]); setAnalyzedFrames([]); setAnalysisContext(undefined); setRefinements({}); setDuplicateFrameApproval(undefined); setSimilarFrameApproval(undefined); setPreflightSummary('');
      setError(additions.length ? `已在 ${clock(start)}–${clock(end)} 本地补抽 ${additions.length} 张代表帧；尚未选择、发送或调用模型。` : '该空档没有生成新的时间点，当前选择未改变。');
    } catch (cause) { if (serial === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (serial === request.current) setCoverageBusy(false); }
  };

  const removeCoverageSupplements = (frames: CoverageSupplementFrame[], label: string) => {
    const supplementalIds = new Set(frames.map((frame) => frame.id));
    const batchIds = new Set(frames.map((frame) => frame.coverageBatchId));
    const removedSelected = [...selected].filter((id) => supplementalIds.has(id)).length;
    setCoverageSupplements((current) => current.filter((frame) => !supplementalIds.has(frame.id))); setLastCoverageRecommendationSelection(undefined); setLastCoverageDifferenceSelection(undefined); setSelected((current) => new Set([...current].filter((id) => !supplementalIds.has(id))));
    setCoverageBatchDifferences((current) => Object.fromEntries(Object.entries(current).filter(([batchId]) => !batchIds.has(batchId))));
    setCoverageDifferenceReasons((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.split('|').some((id) => supplementalIds.has(id)))));
    setUploadConfirmed(false); setCandidates([]); setSequences([]); setAnalyzedFrames([]); setAnalysisContext(undefined); setRefinements({}); setDuplicateFrameApproval(undefined); setSimilarFrameApproval(undefined); setPreflightSummary('');
    setError(`${label} ${frames.length} 张临时空档补抽帧${removedSelected ? `，并从当前选择移除 ${removedSelected} 张` : ''}；基础画面索引保持不变。`);
  };
  const clearCoverageSupplements = () => removeCoverageSupplements(coverageSupplements, '已清除');
  const undoLastCoverageSupplementBatch = () => {
    const lastBatchId = coverageSupplements[coverageSupplements.length - 1]?.coverageBatchId;
    if (!lastBatchId) return;
    removeCoverageSupplements(coverageSupplements.filter((frame) => frame.coverageBatchId === lastBatchId), '已撤销最近一批');
  };
  const selectCoverageSupplementBatch = (frames: CoverageSupplementFrame[], batchNumber: number) => {
    const next = [...new Set([...selected, ...frames.map((frame) => frame.id)])];
    if (next.length > 12) return setError(`第 ${batchNumber} 批无法整批选择：合计 ${next.length} 张，超过单次 12 张上限。请先取消其他截图。`);
    choose(next); setError(`已选择第 ${batchNumber} 批 ${frames.length} 张临时补抽帧；请重新检查负载和发送确认。`);
  };
  const deselectCoverageSupplementBatch = (frames: CoverageSupplementFrame[], batchNumber: number) => {
    const ids = new Set(frames.map((frame) => frame.id));
    const removed = [...selected].filter((id) => ids.has(id)).length;
    choose([...selected].filter((id) => !ids.has(id))); setError(`已取消第 ${batchNumber} 批中的 ${removed} 张当前选择；批次帧仍保留在列表中。`);
  };
  const applyRecommendedCoverageSupplementBatch = () => {
    if (!recommendedCoverageSupplementBatch || recommendedCoverageSupplementBatchIndex < 0) return;
    const batch = coverageSupplementBatches[recommendedCoverageSupplementBatchIndex];
    const preview = coverageSupplementBatchPreview(batch.frames);
    if (preview.overLimit) return;
    const addedIds = batch.frames.map((frame) => frame.id).filter((id) => !selected.has(id));
    selectCoverageSupplementBatch(batch.frames, recommendedCoverageSupplementBatchIndex + 1);
    setLastCoverageRecommendationSelection({
      batchId: batch.id,
      batchNumber: recommendedCoverageSupplementBatchIndex + 1,
      addedIds,
      beforeLargestGapSeconds: selectedCoverage.largestGap.seconds,
      afterLargestGapSeconds: preview.largestGapSeconds,
      addedImageBytes: preview.addedImageBytes,
      addedTranscriptCharacters: preview.addedTranscriptCharacters,
    });
  };
  const undoRecommendedCoverageSupplementBatch = () => {
    if (!lastCoverageRecommendationSelection) return;
    const addedIds = new Set(lastCoverageRecommendationSelection.addedIds);
    choose([...selected].filter((id) => !addedIds.has(id)));
    setError(`已撤销刚才第 ${lastCoverageRecommendationSelection.batchNumber} 批建议新增的 ${addedIds.size} 张选择；此前人工选择保持不变。`);
  };
  const inspectCoverageSupplementBatchDifferences = async (batchId: string, frames: CoverageSupplementFrame[]) => {
    setCoverageBatchDifferences((current) => ({ ...current, [batchId]: { busy: true } }));
    try {
      const input = frames.map((frame) => ({ id: frame.id, time: frame.time, windowStart: frame.windowStart, windowEnd: frame.windowEnd, image: frame.image, transcript: '' }));
      let fingerprints = await fingerprintVisualUnderstandingFrames(input);
      fingerprints = await addVisualUnderstandingPerceptualHashes(input, fingerprints);
      const pairs = compareVisualUnderstandingAdjacentFrames(fingerprints);
      setCoverageBatchDifferences((current) => ({ ...current, [batchId]: { busy: false, pairs } }));
    } catch (cause) {
      setCoverageBatchDifferences((current) => ({ ...current, [batchId]: { busy: false, error: cause instanceof Error ? cause.message : String(cause) } }));
    }
  };
  const coverageDifferencePairSelectionPreview = (pair: VisualUnderstandingAdjacentFrameDifference) => {
    const pairIds = [pair.first.id, pair.second.id];
    const addedIds = pairIds.filter((id) => !selected.has(id));
    const mergedIds = [...new Set([...selected, ...pairIds])];
    const nextPayload = coveragePayloadFor(mergedIds);
    const addedImageBytes = nextPayload.imageBytes - selectedPayload.imageBytes;
    return {
      addedIds,
      mergedIds,
      payload: nextPayload,
      coverage: summarizeVisualUnderstandingCoverage(indexedFrames.filter((frame) => mergedIds.includes(frame.id)), source.duration),
      addedImageBytes,
      addedTranscriptCharacters: nextPayload.transcriptCharacters - selectedPayload.transcriptCharacters,
      overLimit: mergedIds.length > 12,
      overSessionImageBudget: addedIds.length > remainingImageBudget,
      overSessionImageByteBudget: addedImageBytes > remainingImageByteBudget,
    };
  };
  const coverageDifferencePairSelectionBlock = (preview: ReturnType<typeof coverageDifferencePairSelectionPreview>) => {
    if (preview.addedIds.length === 0) return '两端已在当前选择中';
    if (preview.overLimit) return `加入后共 ${preview.mergedIds.length} 张，超过单次 12 张上限`;
    if (preview.overSessionImageBudget || preview.overSessionImageByteBudget) return `${preview.overSessionImageBudget ? `需新增 ${preview.addedIds.length} 张，图片额度只剩 ${remainingImageBudget} 张` : ''}${preview.overSessionImageBudget && preview.overSessionImageByteBudget ? '；' : ''}${preview.overSessionImageByteBudget ? `需新增 ${bytesLabel(preview.addedImageBytes)}，容量额度只剩 ${bytesLabel(remainingImageByteBudget)}` : ''}`;
    if (providerReadinessBlock) return `视觉模型服务不可用：${providerReadinessBlock.replace(/[。.!！?？]+$/, '')}`;
    if (remainingRequestBudget < 1) return `会话请求额度已用完（${sessionUsage.requests}/${sessionBudget.maxRequests}）`;
    if (currentModelTokenStop) return `当前模型已达到 Token 停止线：${currentModelTokenStop}`;
    return '';
  };
  const selectCoverageDifferencePair = (pair: VisualUnderstandingAdjacentFrameDifference, batchNumber: number, differenceRank: number, differenceCount: number, selectionReason = '') => {
    const preview = coverageDifferencePairSelectionPreview(pair);
    const normalizedReason = selectionReason.trim();
    if (differenceRank > 1 && !normalizedReason) return setError(`第 ${batchNumber} 批 ${clock(pair.first.time)}–${clock(pair.second.time)} 不是默认最高差异窗口；请先填写人工改选理由。`);
    if (preview.overLimit) return setError(`第 ${batchNumber} 批 ${clock(pair.first.time)}–${clock(pair.second.time)} 差异窗口两端无法选择：合计 ${preview.mergedIds.length} 张，超过单次 12 张上限。请先取消其他截图。`);
    const { addedIds, addedImageBytes } = preview;
    const pairLabel = `${clock(pair.first.time)}–${clock(pair.second.time)}`;
    if (addedIds.length > remainingImageBudget || addedImageBytes > remainingImageByteBudget) return setError(`第 ${batchNumber} 批 ${pairLabel} 差异窗口两端无法选择：${addedIds.length > remainingImageBudget ? `需新增 ${addedIds.length} 张，图片额度只剩 ${remainingImageBudget} 张` : ''}${addedIds.length > remainingImageBudget && addedImageBytes > remainingImageByteBudget ? '；' : ''}${addedImageBytes > remainingImageByteBudget ? `需新增 ${bytesLabel(addedImageBytes)}，容量额度只剩 ${bytesLabel(remainingImageByteBudget)}` : ''}。请调整会话预算或手动选择，发送门禁仍会复查。`);
    if (providerReadinessBlock) return setError(`第 ${batchNumber} 批 ${pairLabel} 差异窗口两端无法选择：当前视觉模型服务不可用，${providerReadinessBlock} 完成配置、重新探测或切换可用模型后再试。`);
    if (remainingRequestBudget < 1) return setError(`第 ${batchNumber} 批 ${pairLabel} 差异窗口两端无法选择：当前会话请求额度已用完（${sessionUsage.requests}/${sessionBudget.maxRequests}）。请提高请求上限或手动选择，正式分析前仍会复查。`);
    if (currentModelTokenStop) return setError(`第 ${batchNumber} 批 ${pairLabel} 差异窗口两端无法选择：当前模型已达到 Token 停止线，${currentModelTokenStop}。请提高停止线、切换模型或手动选择；下一次请求用量仍无法预知。`);
    choose(preview.mergedIds);
    const batchId = coverageSupplements.find((frame) => frame.id === pair.first.id)?.coverageBatchId;
    if (batchId) {
      const decisionId = globalThis.crypto.randomUUID();
      const selectedAt = new Date().toISOString();
      const frozenDecision = {
        decisionId, batchId, batchNumber, addedIds, firstTime: pair.first.time, secondTime: pair.second.time,
        hammingDistance: pair.hammingDistance, differenceRank, differenceCount, wasLargest: differenceRank === 1, selectionReason: normalizedReason || undefined,
        beforeLargestGapSeconds: selectedCoverage.largestGap.seconds,
        afterLargestGapSeconds: preview.coverage.largestGap.seconds,
        addedImageBytes,
        addedTranscriptCharacters: preview.addedTranscriptCharacters,
      };
      setLastCoverageDifferenceSelection(frozenDecision);
      const decisionRecord: CoverageDifferenceDecisionRecord = {
        id: decisionId, batchId, batchNumber, firstTime: pair.first.time, secondTime: pair.second.time,
        hammingDistance: pair.hammingDistance, differenceRank, differenceCount, wasLargest: differenceRank === 1, selectionReason: normalizedReason || undefined,
        addedImageCount: addedIds.length, addedImageBytes, addedTranscriptCharacters: preview.addedTranscriptCharacters,
        beforeLargestGapSeconds: selectedCoverage.largestGap.seconds, afterLargestGapSeconds: preview.coverage.largestGap.seconds,
        selectedAt, status: 'applied',
      };
      setCoverageDifferenceDecisionHistory((current) => [decisionRecord, ...current].slice(0, 20));
    }
    setError(`已把第 ${batchNumber} 批 ${clock(pair.first.time)}–${clock(pair.second.time)} 差异窗口两端合并进当前选择，新增 ${addedIds.length} 张；请人工核对画面并重新确认发送。`);
  };
  const undoCoverageDifferencePairSelection = () => {
    if (!lastCoverageDifferenceSelection) return;
    const addedIds = new Set(lastCoverageDifferenceSelection.addedIds);
    choose([...selected].filter((id) => !addedIds.has(id)));
    const undoneAt = new Date().toISOString();
    setCoverageDifferenceDecisionHistory((current) => current.map((record) => record.id === lastCoverageDifferenceSelection.decisionId ? { ...record, status: 'undone', undoneAt } : record));
    setError(`已撤销刚才第 ${lastCoverageDifferenceSelection.batchNumber} 批 ${clock(lastCoverageDifferenceSelection.firstTime)}–${clock(lastCoverageDifferenceSelection.secondTime)} 差异窗口新增的 ${addedIds.size} 张选择；此前人工选择保持不变。`);
  };

  const runAnalysis = async (frames: VisualUnderstandingFrame[], clearExisting: boolean, pass: AnalysisContext['pass'], initialSequence?: VisualUnderstandingSequenceCandidate) => {
    if (!bridge || analyzing || frames.length < 1) return;
    const payload = summarizeVisualUnderstandingPayload(frames);
    const violations = visualUnderstandingBudgetViolations(sessionUsage, payload, sessionBudget);
    if (violations.length) return setError(`本次分析已被会话预算阻止：${violations.join('；')}。请调整预算后重新确认。`);
    const tokenStop = selectedProvider ? visualUnderstandingTokenStop(sessionTokenUsage, selectedProvider.id, selectedProvider.model, sessionBudget.maxReportedTokensPerModel) : '';
    if (tokenStop) return setError(`本次分析已被 Token 停止线阻止：${tokenStop}。提高停止线后可继续；下一次请求的用量无法预知。`);
    const serial = ++request.current;
    setAnalyzing(true); setPreflightSummary(''); if (clearExisting) { setCandidates([]); setSequences([]); } setError('');
    const attemptProviderId = selectedProvider?.id ?? providerId;
    const attemptProvider = selectedProvider?.provider ?? '';
    const attemptModel = selectedProvider?.model ?? '';
    const sessionRequestNumber = sessionUsage.requests + 1;
    let requestId = '';
    let requestedAt = '';
    let requestFrames: VisualUnderstandingFrameFingerprint[] = [];
    let duplicateFrameReview: VisualUnderstandingDuplicateFrameReview | undefined;
    let similarFrameReview: VisualUnderstandingSimilarFrameReview | undefined;
    try {
      const inspection = await inspectFramesLocally(frames);
      requestFrames = inspection.fingerprints;
      if (serial !== request.current) return;
      const { duplicateGroups, duplicateSignature, similarPairs, similarSignature } = inspection;
      if (duplicateGroups.length && (duplicateFrameApproval?.signature !== duplicateSignature || !duplicateFrameApproval.confirmed)) {
        setDuplicateFrameApproval({ signature: duplicateSignature, groups: duplicateGroups, confirmed: false });
        setError(`检测到 ${duplicateGroups.reduce((total, group) => total + group.frames.length, 0)} 张截图存在完全相同的图片内容。请检查重复时间后明确确认是否仍要发送。`);
        return;
      }
      if (duplicateGroups.length) duplicateFrameReview = {
        confirmed: true,
        confirmedAt: duplicateFrameApproval?.confirmedAt ?? new Date().toISOString(),
        groups: duplicateGroups.map((group) => ({ sha256: group.sha256, frameIds: group.frames.map((frame) => frame.id) })),
      };
      setDuplicateFrameApproval(undefined);
      if (similarPairs.length && (similarFrameApproval?.signature !== similarSignature || !similarFrameApproval.confirmed)) {
        setSimilarFrameApproval({ signature: similarSignature, pairs: similarPairs, confirmed: false });
        setError(`检测到 ${similarPairs.length} 组编码不同但画面高度相似的截图。请检查对应时间后明确确认是否仍要发送。`);
        return;
      }
      if (similarPairs.length) similarFrameReview = {
        confirmed: true,
        confirmedAt: similarFrameApproval?.confirmedAt ?? new Date().toISOString(),
        maxHammingDistance: similarityThreshold,
        pairs: similarPairs.map((pair) => ({ firstFrameId: pair.first.id, secondFrameId: pair.second.id, hammingDistance: pair.hammingDistance })),
      };
      setSimilarFrameApproval(undefined);
      requestId = `visual-request-${globalThis.crypto.randomUUID()}`;
      requestedAt = new Date().toISOString();
      setSessionUsage((current) => ({ requests: current.requests + 1, imageCount: current.imageCount + payload.imageCount, imageBytes: current.imageBytes + payload.imageBytes, transcriptCharacters: current.transcriptCharacters + payload.transcriptCharacters }));
      const next = await bridge.analyzeSourceVisualFrames(frames, providerId);
      const completedAt = new Date().toISOString();
      const resolvedProviderId = next.providerId ?? attemptProviderId;
      const resolvedProvider = next.provider ?? attemptProvider;
      setRequestHistory((current) => [...current, { requestId, requestedAt, completedAt, providerId: resolvedProviderId, provider: resolvedProvider, model: next.model, pass, sessionRequestNumber, payload: { ...payload }, frames: requestFrames.map((frame) => ({ ...frame })), ...(duplicateFrameReview ? { duplicateFrameReview: structuredClone(duplicateFrameReview) } : {}), ...(similarFrameReview ? { similarFrameReview: structuredClone(similarFrameReview) } : {}), status: 'succeeded' as const, ...(next.tokenUsage ? { tokenUsage: { ...next.tokenUsage } } : {}) }].slice(-100));
      if (next.tokenUsage) setSessionTokenUsage((current) => addVisualUnderstandingTokenUsage(current, { providerId: resolvedProviderId, provider: resolvedProvider, model: next.model }, next.tokenUsage!));
      if (serial === request.current) {
        setAnalyzedFrames(frames);
        setAnalysisContext({ providerId: resolvedProviderId, provider: resolvedProvider, model: next.model, pass, transcriptIncluded: includeTranscript, payload, sessionRequestNumber, requestId, requestedAt, requestFrames, duplicateFrameReview, similarFrameReview, tokenUsage: next.tokenUsage });
        setCandidates(next.candidates.map((candidate) => ({ ...candidate, reviewed: false, kind: 'action', saved: false, modelSnapshot: structuredClone(candidate) })));
        setSequences((next.sequences ?? []).map((sequence) => ({
          ...sequence, reviewed: false, kind: 'action', saved: false, modelSnapshot: structuredClone(sequence), disagreementAcknowledged: false,
          ...(initialSequence ? { refinementComparison: compareVisualUnderstandingSequences(initialSequence, sequence) } : {}),
        })));
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (requestId) setRequestHistory((current) => [...current, { requestId, requestedAt, completedAt: new Date().toISOString(), providerId: attemptProviderId, provider: attemptProvider, model: attemptModel, pass, sessionRequestNumber, payload: { ...payload }, frames: requestFrames.map((frame) => ({ ...frame })), ...(duplicateFrameReview ? { duplicateFrameReview: structuredClone(duplicateFrameReview) } : {}), ...(similarFrameReview ? { similarFrameReview: structuredClone(similarFrameReview) } : {}), status: 'failed' as const, error: message }].slice(-100));
      if (serial === request.current) setError(message);
    }
    finally { if (serial === request.current) setAnalyzing(false); }
  };

  const analyze = async () => {
    if (!uploadConfirmed || selected.size < 1) return;
    const frames: VisualUnderstandingFrame[] = selectedAnalysisFrames();
    await runAnalysis(frames, true, 'initial');
  };

  const evidenceFrames = (ids: string[]) => ids.map((id) => analyzedFrames.find((frame) => frame.id === id)).filter((frame): frame is VisualUnderstandingFrame => Boolean(frame))
    .map(({ id, time, windowStart, windowEnd }) => ({ id, time, windowStart, windowEnd }));

  const evidenceBase = (mode: SourceActionVisualEvidence['mode'], ids: string[], proposal: VisualUnderstandingCandidate | VisualUnderstandingSequenceCandidate, refinementComparison?: SourceActionVisualRefinementComparison, disagreementAcknowledged = false): SourceActionVisualEvidence => {
    const frames = evidenceFrames(ids);
    const byId = new Map(frames.map((frame) => [frame.id, frame]));
    return {
      source: 'model-assisted', mode,
      providerId: analysisContext?.providerId ?? providerId,
      provider: analysisContext?.provider ?? selectedProvider?.provider ?? '',
      model: analysisContext?.model ?? selectedProvider?.model ?? '',
      analysisPass: analysisContext?.pass ?? 'initial',
      transcriptIncluded: analysisContext?.transcriptIncluded ?? includeTranscript,
      ...(analysisContext ? { requestPayload: { ...analysisContext.payload, requestId: analysisContext.requestId, requestedAt: analysisContext.requestedAt, sessionRequestNumber: analysisContext.sessionRequestNumber, ...(analysisContext.tokenUsage ? { tokenUsage: { ...analysisContext.tokenUsage } } : {}), ...(analysisContext.duplicateFrameReview ? { duplicateFrameReview: structuredClone(analysisContext.duplicateFrameReview) } : {}), ...(analysisContext.similarFrameReview ? { similarFrameReview: structuredClone(analysisContext.similarFrameReview) } : {}), frames: analysisContext.requestFrames.map((frame) => ({ ...frame })) } } : {}),
      frames,
      proposal: { subject: proposal.subject, action: proposal.action, object: proposal.object, result: proposal.result, shot: proposal.shot, tags: [...proposal.tags] },
      uncertainty: proposal.uncertainty,
      confidence: proposal.confidence,
      ...(refinementComparison ? { refinementComparison: structuredClone(refinementComparison) } : {}),
      ...(refinementComparison?.status === 'changed' && disagreementAcknowledged ? { refinementReview: { acknowledged: true as const, resolution: 'human-confirmed-final-fields' as const, reviewedAt: new Date().toISOString() } } : {}),
      ...('continuity' in proposal ? {
        continuity: proposal.continuity,
        visibleEvidence: proposal.evidence,
        changeWindows: proposal.changeWindows.map((window) => ({
          ...window,
          start: byId.get(window.beforeFrameId)?.time ?? 0,
          end: byId.get(window.afterFrameId)?.time ?? 0,
        })),
      } : {}),
    };
  };

  const patchCandidate = (frameId: string, patch: Partial<CandidateDraft>) => setCandidates((rows) => rows.map((row) => row.frameId === frameId ? { ...row, ...patch, saved: false } : row));
  const sequenceKey = (frameIds: string[]) => frameIds.join('|');
  const patchSequence = (frameIds: string[], patch: Partial<SequenceDraft>) => setSequences((rows) => rows.map((row) => {
    if (sequenceKey(row.frameIds) !== sequenceKey(frameIds)) return row;
    const changesFinalFields = Object.keys(patch).some((key) => !['reviewed', 'disagreementAcknowledged', 'saved'].includes(key));
    return { ...row, ...patch, ...(changesFinalFields ? { disagreementAcknowledged: false } : {}), saved: patch.saved ?? false };
  }));
  const accept = (candidate: CandidateDraft) => {
    try {
      const frame = analyzedFrames.find((item) => item.id === candidate.frameId);
      if (!frame) throw new Error('候选截图已经失效，请重新分析。');
      const current = useEditorStore.getState().sourceMedia.find((item) => item.id === source.id);
      if (!current) throw new Error('原片引用已经失效。');
      const entry = createActionEntry(current, { start: frame.windowStart, end: frame.windowEnd }, {
        subject: candidate.subject, action: candidate.action, object: candidate.object, result: candidate.result,
        shot: candidate.shot, tags: candidate.tags.join('，'), kind: candidate.kind,
      }, candidate.reviewed, evidenceBase('single-frame', [candidate.frameId], candidate.modelSnapshot));
      updateSourceMedia(current.id, { eventMarkers: [...(current.eventMarkers ?? []), entry].sort((a, b) => a.start - b.start), roughCutPlan: undefined });
      setCandidates((rows) => rows.map((row) => row.frameId === candidate.frameId ? { ...row, saved: true } : row));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const acceptSequence = (sequence: SequenceDraft) => {
    try {
      const referenced = sequence.frameIds.map((id) => analyzedFrames.find((frame) => frame.id === id));
      if (referenced.some((frame) => !frame)) throw new Error('跨帧候选截图已经失效，请重新分析。');
      const first = referenced[0]!;
      const last = referenced[referenced.length - 1]!;
      const current = useEditorStore.getState().sourceMedia.find((item) => item.id === source.id);
      if (!current) throw new Error('原片引用已经失效。');
      const entry = createActionEntry(current, { start: first.windowStart, end: last.windowEnd }, {
        subject: sequence.subject, action: sequence.action, object: sequence.object, result: sequence.result,
        shot: sequence.shot, tags: [...sequence.tags, '跨帧确认'].join('，'), kind: sequence.kind,
      }, sequence.reviewed, evidenceBase('cross-frame', sequence.frameIds, sequence.modelSnapshot, sequence.refinementComparison, sequence.disagreementAcknowledged));
      updateSourceMedia(current.id, { eventMarkers: [...(current.eventMarkers ?? []), entry].sort((a, b) => a.start - b.start), roughCutPlan: undefined });
      patchSequence(sequence.frameIds, { saved: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const generateRefinement = async (sequence: SequenceDraft) => {
    if (!bridge || analyzing) return;
    const serial = request.current;
    const key = sequenceKey(sequence.frameIds);
    const referenced = sequence.frameIds.map((id) => analyzedFrames.find((frame) => frame.id === id));
    if (referenced.some((frame) => !frame)) return setError('跨帧候选截图已经失效，请重新分析。');
    const supplementalFrames = selectVisualRefinementBudget(Math.max(0, sessionBudget.maxImages - sessionUsage.imageCount), sequence.frameIds.length);
    if (!supplementalFrames) return setError('剩余图片预算不足：第二轮需要保留原证据帧，并至少补抽 2 张中间帧。');
    const first = referenced[0]!; const last = referenced[referenced.length - 1]!;
    setRefinements((current) => ({ ...current, [key]: { confirmed: false, busy: true } }));
    try {
      const next = await bridge.generateSourceVisualRefinement(source.path, first.time, last.time, supplementalFrames);
      if (serial === request.current) setRefinements((current) => ({ ...current, [key]: { result: next, confirmed: false, busy: false } }));
    } catch (cause) {
      if (serial === request.current) setRefinements((current) => ({ ...current, [key]: { confirmed: false, busy: false, error: cause instanceof Error ? cause.message : String(cause) } }));
    }
  };

  const analyzeRefinement = async (sequence: SequenceDraft) => {
    const key = sequenceKey(sequence.frameIds);
    const refinement = refinements[key];
    if (!refinement?.result || !refinement.confirmed) return;
    const endpoints = sequence.frameIds.map((id) => analyzedFrames.find((frame) => frame.id === id)).filter((frame) => Boolean(frame));
    if (endpoints.length !== sequence.frameIds.length) return setError('跨帧候选截图已经失效，请重新分析。');
    const frames: VisualUnderstandingFrame[] = [
      ...endpoints.map((frame) => ({ id: frame!.id, time: frame!.time, windowStart: frame!.windowStart, windowEnd: frame!.windowEnd, image: frame!.image, transcript: analysisTranscriptFor(frame!.windowStart, frame!.windowEnd) })),
      ...refinement.result.frames.map((frame, index) => ({ id: `refine-${key.replace(/[^a-zA-Z0-9-]/g, '-')}-${index + 1}`, time: frame.time, windowStart: frame.windowStart, windowEnd: frame.windowEnd, image: frame.image, transcript: analysisTranscriptFor(frame.windowStart, frame.windowEnd) })),
    ].sort((a, b) => a.time - b.time);
    await runAnalysis(frames, false, 'refinement', sequence.modelSnapshot);
  };

  const applyRepresentativeSuggestion = (pairs: Array<{ firstFrameId: string; secondFrameId: string }>, label: string) => {
    try {
      const suggestion = previewVisualUnderstandingRepresentativeSelection(selectedAnalysisFrames(), pairs);
      setSelected(new Set(suggestion.keptIds)); setUploadConfirmed(false); setCandidates([]); setSequences([]); setAnalyzedFrames([]); setAnalysisContext(undefined); setRefinements({}); setDuplicateFrameApproval(undefined); setSimilarFrameApproval(undefined); setPreflightSummary('');
      setError(`${label}已移除 ${suggestion.removedIds.length} 张较晚截图，负载从 ${suggestion.before.imageCount} 张 / ${bytesLabel(suggestion.before.imageBytes)} / 口播 ${suggestion.before.transcriptCharacters} 字降至 ${suggestion.after.imageCount} 张 / ${bytesLabel(suggestion.after.imageBytes)} / 口播 ${suggestion.after.transcriptCharacters} 字。请重新检查选择并确认发送。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const representativeSuggestionSummary = (pairs: Array<{ firstFrameId: string; secondFrameId: string }>) => {
    const preview = previewVisualUnderstandingRepresentativeSelection(selectedAnalysisFrames(), pairs);
    return `预计减少 ${preview.saved.imageCount} 张 / ${bytesLabel(preview.saved.imageBytes)} / 口播 ${preview.saved.transcriptCharacters} 字；保留 ${preview.after.imageCount} 张。`;
  };
  const choose = (ids: string[]) => { setSelected(new Set(ids)); setLastCoverageRecommendationSelection(undefined); setLastCoverageDifferenceSelection(undefined); setUploadConfirmed(false); setCandidates([]); setSequences([]); setAnalyzedFrames([]); setAnalysisContext(undefined); setRefinements({}); setDuplicateFrameApproval(undefined); setSimilarFrameApproval(undefined); setPreflightSummary(''); };
  const toggleFrameSelection = (frameId: string, checked: boolean, message?: string) => {
    const next = new Set(selected);
    checked ? next.add(frameId) : next.delete(frameId);
    if (next.size > 12) return setError('每次最多选择 12 张截图。');
    choose([...next]);
    if (message) setError(message);
  };
  const probeProvider = async () => {
    if (!bridge || !selectedProvider?.local || !selectedProvider.available) return;
    setProbe(undefined); setError('');
    try { setProbe(await bridge.probeSourceVisualUnderstandingProvider(providerId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const downloadRequestHistory = async () => {
    try {
      const log = await createVisualUnderstandingRequestLog(requestHistory);
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(log, null, 2)}\n`], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `hyperframes-visual-requests-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const downloadCoverageDifferenceDecisionHistory = async () => {
    try {
      const records = coverageDifferenceDecisionHistory;
      const log = {
        format: 'hyperframes-visual-difference-decisions-v1',
        exportedAt: new Date().toISOString(),
        source: { id: source.id, duration: source.duration },
        recordCount: records.length,
        records,
        recordsSha256: await sha256Text(JSON.stringify(records)),
      };
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(log, null, 2)}\n`], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `hyperframes-visual-difference-decisions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const verifyRequestHistoryFile = async (file?: File) => {
    if (!file) return;
    setRequestLogVerification(undefined);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('视觉请求记录文件超过 5 MB。');
      const input = JSON.parse(await file.text()) as unknown;
      const result = await verifyVisualUnderstandingRequestLog(input);
      setRequestLogVerification({ ok: true, message: `验证通过：${result.recordCount} 条请求，${result.failedCount} 条失败，${result.reportedTokenRequests} 条带 Token，记录哈希 ${result.recordsSha256}。` });
    } catch (cause) { setRequestLogVerification({ ok: false, message: cause instanceof Error ? cause.message : String(cause) }); }
  };
  const field = 'w-full rounded border border-stroke bg-panel px-1.5 py-1 text-ink';
  return <section aria-label="本地画面索引" className="space-y-2 rounded border border-cyan-300/20 p-2 text-[10px] text-ink-dim">
    <h4 className="font-semibold text-cyan-100">画面索引与视觉候选 · 试用</h4>
    <p>先在本机筛选代表帧。只有你主动选择并确认后，截图和对应口播才会发送给视觉模型；模型结果不会自动写入剪辑。</p>
    <div className="flex flex-wrap items-end gap-2">
      <label>最多截图<select aria-label="截图预算" value={maxFrames} onChange={(event) => setMaxFrames(Number(event.target.value))} className="ml-1 rounded border border-stroke bg-panel px-1 py-1 text-ink"><option value={12}>12 张</option><option value={24}>24 张</option><option value={48}>48 张</option></select></label>
      <label>期望间隔<select aria-label="期望抽帧间隔" value={interval} onChange={(event) => setInterval(Number(event.target.value))} className="ml-1 rounded border border-stroke bg-panel px-1 py-1 text-ink"><option value={10}>10 秒</option><option value={20}>20 秒</option><option value={30}>30 秒</option></select></label>
      <button type="button" disabled={!bridge || busy || source.status === 'missing'} onClick={() => void generate()} className="rounded border border-cyan-300/30 px-2 py-1 text-cyan-100 disabled:opacity-45">{busy ? '正在本地扫描与抽帧…' : '生成画面索引'}</button>
    </div>
    {!bridge && <p>请在桌面版中使用。</p>}
    {error && <p role="alert" className="text-red-200">{error}</p>}
    {duplicateFrameApproval && <div className="space-y-1 rounded border border-amber-300/30 bg-amber-300/[0.04] p-2"><p className="text-amber-100">完全相同截图预警</p>{duplicateFrameApproval.groups.map((group) => <p key={group.sha256} className="break-all text-ink-faint">{group.frames.map((frame) => clock(frame.time)).join(' / ')} · SHA-256 {group.sha256}</p>)}<p>{representativeSuggestionSummary(duplicateFrameApproval.groups.flatMap((group) => group.frames.slice(1).map((frame) => ({ firstFrameId: group.frames[0].id, secondFrameId: frame.id }))))}</p><button type="button" onClick={() => applyRepresentativeSuggestion(duplicateFrameApproval.groups.flatMap((group) => group.frames.slice(1).map((frame) => ({ firstFrameId: group.frames[0].id, secondFrameId: frame.id }))), '完全重复截图精简建议')} className="rounded border border-amber-300/30 px-2 py-1 text-amber-100">应用精简建议（每组保留较早帧）</button><label className="block"><input aria-label="确认发送完全相同截图" type="checkbox" checked={duplicateFrameApproval.confirmed} onChange={(event) => setDuplicateFrameApproval((current) => current ? { ...current, confirmed: event.target.checked, confirmedAt: event.target.checked ? new Date().toISOString() : undefined } : current)} /> 我确认这些相同画面仍有时间证据价值（例如证明该段没有可见变化），继续发送</label></div>}
    {similarFrameApproval && <div className="space-y-1 rounded border border-orange-300/30 bg-orange-300/[0.04] p-2"><p className="text-orange-100">高度相似截图预警（本地感知哈希）</p>{similarFrameApproval.pairs.map((pair) => <p key={`${pair.first.id}|${pair.second.id}`} className="text-ink-faint">{clock(pair.first.time)} / {clock(pair.second.time)} · 距离 {pair.hammingDistance}/64</p>)}<p>{representativeSuggestionSummary(similarFrameApproval.pairs.map((pair) => ({ firstFrameId: pair.first.id, secondFrameId: pair.second.id })))}</p><button type="button" onClick={() => applyRepresentativeSuggestion(similarFrameApproval.pairs.map((pair) => ({ firstFrameId: pair.first.id, secondFrameId: pair.second.id })), '高度相似截图精简建议')} className="rounded border border-orange-300/30 px-2 py-1 text-orange-100">应用精简建议（保留较早代表帧）</button><label className="block"><input aria-label="确认发送高度相似截图" type="checkbox" checked={similarFrameApproval.confirmed} onChange={(event) => setSimilarFrameApproval((current) => current ? { ...current, confirmed: event.target.checked, confirmedAt: event.target.checked ? new Date().toISOString() : undefined } : current)} /> 我已检查这些相似画面，确认仍有时间或语义证据价值，继续发送</label><p className="text-ink-faint">感知哈希只做低成本相似度提示，可能误报；不会自动删除截图，也不代表画面完全相同。</p></div>}
    {result && <>
      <p>检测到 {result.detectedChanges} 处画面变化，选出 {result.frames.length} 张图（其中 {result.sampledChanges} 张靠近变化点）。实际平均间隔约 {result.interval.toFixed(1)} 秒{result.cached ? ' · 命中本地缓存' : ''}。</p>
      {coverageSupplements.length > 0 && <div className="space-y-1 text-violet-200"><div className="flex flex-wrap items-center gap-2"><span>另有 {coverageSupplements.length} 张、共 {coverageSupplementBatches.length} 批只在证据空档内生成的本地补抽帧；它们尚未自动选择或发送。</span><button type="button" onClick={undoLastCoverageSupplementBatch} className="rounded border border-violet-300/30 px-2 py-1">撤销最近一批空档补抽</button><button type="button" onClick={clearCoverageSupplements} className="rounded border border-violet-300/30 px-2 py-1">清除全部临时空档补抽帧</button></div>{lastCoverageRecommendationSelection ? <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-300/20 p-1.5"><span className="text-emerald-200">刚才采用第 {lastCoverageRecommendationSelection.batchNumber} 批建议，新增选择 {lastCoverageRecommendationSelection.addedIds.length} 张 · 最大空档 {lastCoverageRecommendationSelection.beforeLargestGapSeconds.toFixed(1)} → {lastCoverageRecommendationSelection.afterLargestGapSeconds.toFixed(1)} 秒 · 新增图片 {bytesLabel(lastCoverageRecommendationSelection.addedImageBytes)} / 口播 {lastCoverageRecommendationSelection.addedTranscriptCharacters} 字。</span><button type="button" onClick={undoRecommendedCoverageSupplementBatch} className="rounded border border-emerald-300/30 px-2 py-1 text-emerald-100">撤销刚才的建议选择</button><span className="text-ink-faint">只撤销该操作新增的帧，保留此前人工选择。</span></div> : recommendedCoverageSupplementBatch && recommendedCoverageSupplementBatchIndex >= 0 ? <div className="flex flex-wrap items-center gap-2"><p className="text-emerald-200">本地比较建议：第 {recommendedCoverageSupplementBatchIndex + 1} 批覆盖收益最高，预计把最大空档缩短 {recommendedCoverageSupplementBatch.gapReductionSeconds.toFixed(1)} 秒。</p><button type="button" onClick={applyRecommendedCoverageSupplementBatch} className="rounded border border-emerald-300/30 px-2 py-1 text-emerald-100">选择建议的第 {recommendedCoverageSupplementBatchIndex + 1} 批</button><span className="text-ink-faint">只改变当前勾选，仍需检查负载并确认发送。</span></div> : imageBudgetEligibleCoverageSupplementBatch && providerReadinessBlock ? <p className="text-amber-200">第 {coverageSupplementBatches.findIndex((batch) => batch.id === imageBudgetEligibleCoverageSupplementBatch.id) + 1} 批可缩小最大证据空档，但当前视觉模型服务不可用：{providerReadinessBlock.replace(/[。.!！?？]+$/, '')}。完成配置、重新探测或切换可用模型后可恢复建议。</p> : imageBudgetEligibleCoverageSupplementBatch && remainingRequestBudget < 1 ? <p className="text-amber-200">第 {coverageSupplementBatches.findIndex((batch) => batch.id === imageBudgetEligibleCoverageSupplementBatch.id) + 1} 批可缩小最大证据空档，但当前会话请求额度已用完（{sessionUsage.requests}/{sessionBudget.maxRequests}）。提高请求上限后可恢复建议。</p> : imageBudgetEligibleCoverageSupplementBatch && currentModelTokenStop ? <p className="text-amber-200">第 {coverageSupplementBatches.findIndex((batch) => batch.id === imageBudgetEligibleCoverageSupplementBatch.id) + 1} 批可缩小最大证据空档，但当前模型已达到 Token 停止线：{currentModelTokenStop}。提高停止线或切换模型后可恢复建议；下一次请求用量仍无法预知。</p> : improvingCoverageSupplementOverBudget ? <p className="text-amber-200">第 {coverageSupplementBatches.findIndex((batch) => batch.id === improvingCoverageSupplementOverBudget.batch.id) + 1} 批可缩小最大证据空档，但当前会话预算不足：{improvingCoverageSupplementOverBudget.preview.overSessionImageBudget ? `需新增 ${improvingCoverageSupplementOverBudget.preview.addedImageCount} 张，图片额度只剩 ${remainingImageBudget} 张` : ''}{improvingCoverageSupplementOverBudget.preview.overSessionImageBudget && improvingCoverageSupplementOverBudget.preview.overSessionImageByteBudget ? '；' : ''}{improvingCoverageSupplementOverBudget.preview.overSessionImageByteBudget ? `需新增 ${bytesLabel(improvingCoverageSupplementOverBudget.preview.addedImageBytes)}，容量额度只剩 ${bytesLabel(remainingImageByteBudget)}` : ''}。可调整预算或手动选择，发送门禁仍会复查。</p> : <p className="text-amber-200">当前可选补抽批次都不会缩小最大证据空档；它们仍可能提供空档内部的画面证据。</p>}<details className="rounded border border-violet-300/20 p-1.5"><summary>查看补抽批次明细</summary><div className="mt-1 space-y-1">{coverageSupplementBatches.map((batch, index) => {
        const preview = coverageSupplementBatchPreview(batch.frames);
        const gapReduction = preview.overLimit ? 0 : Math.max(0, selectedCoverage.largestGap.seconds - preview.largestGapSeconds);
        const differences = coverageBatchDifferences[batch.id];
        const rankedDifferences = [...(differences?.pairs ?? [])].sort((first, second) => second.hammingDistance - first.hammingDistance || first.first.time - second.first.time || first.second.time - second.second.time);
        const differenceRankByKey = new Map(rankedDifferences.map((pair, rank) => [`${pair.first.id}|${pair.second.id}`, rank + 1]));
        const largestDifference = differences?.pairs?.reduce<VisualUnderstandingAdjacentFrameDifference | undefined>((largest, pair) => !largest || pair.hammingDistance > largest.hammingDistance ? pair : largest, undefined);
        const largestDifferenceIds = largestDifference ? [largestDifference.first.id, largestDifference.second.id] : [];
        const largestDifferenceMergedIds = [...new Set([...selected, ...largestDifferenceIds])];
        const largestDifferenceAddedCount = largestDifferenceIds.filter((id) => !selected.has(id)).length;
        const largestDifferenceOverLimit = selected.size + largestDifferenceAddedCount > 12;
        const largestDifferenceSelectionPreview = largestDifference && !largestDifferenceOverLimit ? {
          coverage: summarizeVisualUnderstandingCoverage(indexedFrames.filter((frame) => largestDifferenceMergedIds.includes(frame.id)), source.duration),
          payload: coveragePayloadFor(largestDifferenceMergedIds),
        } : undefined;
        const largestDifferenceAddedImageBytes = largestDifferenceSelectionPreview ? largestDifferenceSelectionPreview.payload.imageBytes - selectedPayload.imageBytes : 0;
        const largestDifferenceOverSessionImageBudget = largestDifferenceAddedCount > remainingImageBudget;
        const largestDifferenceOverSessionImageByteBudget = largestDifferenceAddedImageBytes > remainingImageByteBudget;
        const largestDifferenceServiceUnavailable = Boolean(providerReadinessBlock);
        const largestDifferenceRequestBudgetUnavailable = remainingRequestBudget < 1;
        const largestDifferenceTokenStopReached = Boolean(currentModelTokenStop);
        return <div key={batch.id} className="space-y-1 rounded border border-violet-300/10 p-1.5">
          <div className="flex flex-wrap items-center gap-2"><span>第 {index + 1} 批 · {clock(batch.start)}–{clock(batch.end)} · {batch.frames.length} 张{recommendedCoverageSupplementBatch?.id === batch.id ? ' · 覆盖收益最高' : ''}</span><button type="button" disabled={preview.selectedInBatch === batch.frames.length || preview.overLimit} onClick={() => selectCoverageSupplementBatch(batch.frames, index + 1)} className="rounded border border-emerald-300/30 px-2 py-1 text-emerald-100 disabled:opacity-40">选择第 {index + 1} 批全部帧</button><button type="button" disabled={preview.selectedInBatch === 0} onClick={() => deselectCoverageSupplementBatch(batch.frames, index + 1)} className="rounded border border-stroke px-2 py-1 disabled:opacity-40">取消第 {index + 1} 批选择</button><button type="button" disabled={differences?.busy} onClick={() => void inspectCoverageSupplementBatchDifferences(batch.id, batch.frames)} className="rounded border border-orange-300/30 px-2 py-1 text-orange-100 disabled:opacity-40">{differences?.busy ? `正在本地比较第 ${index + 1} 批…` : `本地比较第 ${index + 1} 批相邻画面`}</button><button type="button" onClick={() => removeCoverageSupplements(batch.frames, `已移除第 ${index + 1} 批`)} className="rounded border border-violet-300/30 px-2 py-1">移除第 {index + 1} 批（{clock(batch.start)}–{clock(batch.end)} · {batch.frames.length} 张）</button></div>
          <p className={preview.overLimit || (!preview.overLimit && (preview.overSessionImageBudget || preview.overSessionImageByteBudget)) ? 'text-amber-200' : 'text-ink-faint'}>当前已选 {preview.selectedInBatch}/{batch.frames.length} 张 · {preview.overLimit ? `整批加入后共 ${preview.mergedIds.length} 张，超过单次 12 张上限` : `整批加入后共 ${preview.mergedIds.length} 张 · 最大空档 ${preview.largestGapSeconds.toFixed(1)} 秒（${gapReduction > 0 ? `缩短 ${gapReduction.toFixed(1)} 秒` : '不变'}） · 新增图片 ${bytesLabel(preview.addedImageBytes)} / 口播 ${preview.addedTranscriptCharacters} 字${preview.overSessionImageBudget ? ` · 超过当前会话剩余 ${remainingImageBudget} 张图片额度` : ''}${preview.overSessionImageByteBudget ? ` · 超过当前会话剩余 ${bytesLabel(remainingImageByteBudget)} 图片容量` : ''}`}</p>
          <div role="group" className="grid grid-cols-2 gap-1 sm:grid-cols-4" aria-label={`第 ${index + 1} 批精确时间点接触表`}>{batch.frames.map((frame) => <article key={frame.id} className={`space-y-1 rounded border p-1 ${selected.has(frame.id) ? 'border-cyan-300/40 text-cyan-100' : 'border-stroke text-ink-faint'}`}><button type="button" aria-label={`回看第 ${index + 1} 批 ${clock(frame.time)}${selected.has(frame.id) ? '（已选）' : '（未选）'}`} onClick={() => onSeek(frame.time)} className="w-full space-y-1 text-left"><img src={frame.image} alt={`第 ${index + 1} 批 ${clock(frame.time)} 补抽缩略图`} loading="lazy" className="aspect-video w-full rounded object-cover" /><span className="block">{clock(frame.time)}{selected.has(frame.id) ? ' · 已选' : ' · 未选'}</span></button><label className="flex items-center gap-1 text-xs"><input type="checkbox" aria-label={`选择第 ${index + 1} 批 ${clock(frame.time)} 补抽帧`} checked={selected.has(frame.id)} onChange={(event) => toggleFrameSelection(frame.id, event.target.checked, `已${event.target.checked ? '选择' : '取消'}第 ${index + 1} 批 ${clock(frame.time)} 补抽帧；请重新检查负载和发送确认。`)} />送入候选分析</label></article>)}</div>
          {differences?.pairs && <div role="group" aria-label={`第 ${index + 1} 批相邻画面差异`} className="space-y-1 rounded border border-orange-300/20 p-1.5 text-ink-faint">
            <p className="text-orange-100">本地感知哈希相邻差异</p>
            {differences.pairs.map((pair) => {
              const pairKey = `${pair.first.id}|${pair.second.id}`;
              const isLargestDifference = largestDifference?.first.id === pair.first.id && largestDifference.second.id === pair.second.id;
              const pairPreview = coverageDifferencePairSelectionPreview(pair);
              const pairBlock = coverageDifferencePairSelectionBlock(pairPreview);
              const differenceRank = differenceRankByKey.get(pairKey) ?? 1;
              const selectionReason = coverageDifferenceReasons[pairKey]?.trim() ?? '';
              const effectivePairBlock = pairBlock || (!isLargestDifference && !selectionReason ? '请先填写人工改选理由' : '');
              return <div key={pairKey} className="flex flex-wrap items-center gap-2">
                <span>{clock(pair.first.time)}–{clock(pair.second.time)} · {pair.hammingDistance}/64 · 差异排名 {differenceRank}/{rankedDifferences.length}{isLargestDifference ? ' · 本批外观变化最高' : ''}</span>
                {!isLargestDifference && <><label className="flex items-center gap-1">改选理由<input aria-label={`第 ${index + 1} 批 ${clock(pair.first.time)}–${clock(pair.second.time)} 人工改选理由`} value={coverageDifferenceReasons[pairKey] ?? ''} maxLength={200} onChange={(event) => setCoverageDifferenceReasons((current) => ({ ...current, [pairKey]: event.target.value }))} placeholder="如：字幕闪烁，不代表动作" className="w-48 rounded border border-stroke bg-panel px-1 py-1 text-ink" /></label><button type="button" disabled={Boolean(effectivePairBlock)} onClick={() => selectCoverageDifferencePair(pair, index + 1, differenceRank, rankedDifferences.length, selectionReason)} className="rounded border border-orange-300/30 px-2 py-1 text-orange-100 disabled:opacity-40">选择第 {index + 1} 批 {clock(pair.first.time)}–{clock(pair.second.time)} 两端</button><span className={effectivePairBlock ? 'text-amber-200' : 'text-ink-faint'}>{effectivePairBlock || `新增 ${pairPreview.addedIds.length} 张 · 图片 ${bytesLabel(pairPreview.addedImageBytes)} / 口播 ${pairPreview.addedTranscriptCharacters} 字 · 最大空档 ${selectedCoverage.largestGap.seconds.toFixed(1)} → ${pairPreview.coverage.largestGap.seconds.toFixed(1)} 秒`}</span></>}
              </div>;
            })}
            {largestDifferenceSelectionPreview && <p className="text-orange-100">最高差异两端加入后：新增 {largestDifferenceAddedCount} 张 · 图片 {bytesLabel(largestDifferenceAddedImageBytes)} / 口播 {largestDifferenceSelectionPreview.payload.transcriptCharacters - selectedPayload.transcriptCharacters} 字 · 最大空档 {selectedCoverage.largestGap.seconds.toFixed(1)} → {largestDifferenceSelectionPreview.coverage.largestGap.seconds.toFixed(1)} 秒。</p>}
            {(largestDifferenceOverSessionImageBudget || largestDifferenceOverSessionImageByteBudget) && <p className="text-amber-200">最高差异两端当前会话预算不足：{largestDifferenceOverSessionImageBudget ? `需新增 ${largestDifferenceAddedCount} 张，图片额度只剩 ${remainingImageBudget} 张` : ''}{largestDifferenceOverSessionImageBudget && largestDifferenceOverSessionImageByteBudget ? '；' : ''}{largestDifferenceOverSessionImageByteBudget ? `需新增 ${bytesLabel(largestDifferenceAddedImageBytes)}，容量额度只剩 ${bytesLabel(remainingImageByteBudget)}` : ''}。可调整预算或手动选择，发送门禁仍会复查。</p>}
            {!largestDifferenceOverSessionImageBudget && !largestDifferenceOverSessionImageByteBudget && largestDifferenceServiceUnavailable && <p className="text-amber-200">最高差异两端当前视觉模型服务不可用：{providerReadinessBlock.replace(/[。.!！?？]+$/, '')}。完成配置、重新探测或切换可用模型后可恢复快捷选择；逐帧手动选择仍保留。</p>}
            {!largestDifferenceOverSessionImageBudget && !largestDifferenceOverSessionImageByteBudget && !largestDifferenceServiceUnavailable && largestDifferenceRequestBudgetUnavailable && <p className="text-amber-200">最高差异两端当前会话请求额度已用完（{sessionUsage.requests}/{sessionBudget.maxRequests}）。提高请求上限后可恢复快捷选择；逐帧手动选择仍保留。</p>}
            {!largestDifferenceOverSessionImageBudget && !largestDifferenceOverSessionImageByteBudget && !largestDifferenceServiceUnavailable && !largestDifferenceRequestBudgetUnavailable && largestDifferenceTokenStopReached && <p className="text-amber-200">最高差异两端当前模型已达到 Token 停止线：{currentModelTokenStop}。提高停止线或切换模型后可恢复快捷选择；下一次请求用量仍无法预知。</p>}
            <button type="button" disabled={!largestDifference || largestDifferenceAddedCount === 0 || largestDifferenceOverLimit || largestDifferenceOverSessionImageBudget || largestDifferenceOverSessionImageByteBudget || largestDifferenceServiceUnavailable || largestDifferenceRequestBudgetUnavailable || largestDifferenceTokenStopReached} onClick={() => largestDifference && selectCoverageDifferencePair(largestDifference, index + 1, 1, rankedDifferences.length)} className="rounded border border-orange-300/30 px-2 py-1 text-orange-100 disabled:opacity-40">选择第 {index + 1} 批最高差异两端</button>
            {lastCoverageDifferenceSelection?.batchId === batch.id && <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-300/20 p-1"><span className="text-emerald-200">刚才选择 {clock(lastCoverageDifferenceSelection.firstTime)}–{clock(lastCoverageDifferenceSelection.secondTime)} 两端，新增 {lastCoverageDifferenceSelection.addedIds.length} 张 · 图片 {bytesLabel(lastCoverageDifferenceSelection.addedImageBytes)} / 口播 {lastCoverageDifferenceSelection.addedTranscriptCharacters} 字 · 最大空档 {lastCoverageDifferenceSelection.beforeLargestGapSeconds.toFixed(1)} → {lastCoverageDifferenceSelection.afterLargestGapSeconds.toFixed(1)} 秒 · 差异 {lastCoverageDifferenceSelection.hammingDistance}/64 · 本批第 {lastCoverageDifferenceSelection.differenceRank}/{lastCoverageDifferenceSelection.differenceCount} · {lastCoverageDifferenceSelection.wasLargest ? '默认最高项' : `人工改选项 · 理由：${lastCoverageDifferenceSelection.selectionReason}`}。</span><button type="button" onClick={undoCoverageDifferencePairSelection} className="rounded border border-emerald-300/30 px-2 py-1 text-emerald-100">撤销刚才第 {index + 1} 批差异窗口选择</button><span>只撤销该操作新增的帧，保留此前人工选择。</span></div>}
            {largestDifferenceOverLimit && <p className="text-amber-200">合并最高差异两端后会超过单次 12 张上限，请先取消其他截图。</p>}
            <p>这个捷径只合并该窗口两端，不替代人工回看；数值只反映缩略图像素结构差异，不能证明动作、语义、因果或精确变化时刻。</p>
          </div>}
          {differences?.error && <p className="text-red-200">本地相邻画面比较失败：{differences.error}</p>}
          <p className="text-ink-faint">接触表只显示本机已生成的补抽截图；点击画面定位原片回看，勾选框单独调整当前选择，本地比较只读取这些缩略图，三者都不会调用模型。</p>
        </div>;
      })}</div></details>{coverageDifferenceDecisionHistory.length > 0 && <details aria-label="本次会话差异窗口选择记录" className="rounded border border-emerald-300/20 p-1.5"><summary>本次会话差异窗口选择记录（{coverageDifferenceDecisionHistory.length}/20）</summary><div className="mt-1 space-y-1">{coverageDifferenceDecisionHistory.map((record, recordIndex) => <article key={record.id} aria-label={`差异窗口选择记录 ${recordIndex + 1}`} className="rounded border border-emerald-300/10 p-1 text-ink-faint"><p>第 {record.batchNumber} 批 · {clock(record.firstTime)}–{clock(record.secondTime)} · {record.status === 'applied' ? '已应用' : '已撤销'} · 差异 {record.hammingDistance}/64 · 本批第 {record.differenceRank}/{record.differenceCount} · {record.wasLargest ? '默认最高项' : '人工改选项'}</p><p>新增 {record.addedImageCount} 张 · 图片 {bytesLabel(record.addedImageBytes)} / 口播 {record.addedTranscriptCharacters} 字 · 最大空档 {record.beforeLargestGapSeconds.toFixed(1)} → {record.afterLargestGapSeconds.toFixed(1)} 秒</p>{record.selectionReason && <p>改选理由：{record.selectionReason}</p>}<p>选择时间 {new Date(record.selectedAt).toLocaleString('zh-CN', { hour12: false })}{record.undoneAt ? ` · 撤销时间 ${new Date(record.undoneAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</p></article>)}</div><div className="mt-1"><button type="button" onClick={() => void downloadCoverageDifferenceDecisionHistory()} className="rounded border border-emerald-300/30 px-2 py-1 text-emerald-100">下载差异窗口选择记录 JSON</button></div><p className="mt-1 text-ink-faint">仅保留当前面板会话最近 20 次操作，不保存图片、不上传，也不写入工程。导出包含素材 ID、时长和记录段 SHA-256，不包含原片路径或口播正文。</p></details>}</div>}
      <p className="text-ink-faint">“画面变化”可能来自硬切、闪光、渐变或运动，不等于已经确认的镜头切换。</p>
      {result.interval > interval + 1 && <p className="text-amber-200">视频较长，截图预算优先；实际覆盖比期望间隔稀疏。可提高截图预算或分段检查。</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={suggestedFrameCount < 1} onClick={() => choose(selectVisualAnalysisFrames(indexedFrames, suggestedFrameCount).map((frame) => frame.id))} className="rounded border border-cyan-300/30 px-2 py-1 text-cyan-100 disabled:opacity-40">按剩余预算选择（{suggestedFrameCount} 张）</button><button type="button" onClick={() => choose(indexedFrames.slice(0, 6).map((frame) => frame.id))} className="rounded border border-stroke px-2 py-1">选择前 6 张</button><button type="button" onClick={() => choose(indexedFrames.slice(0, 12).map((frame) => frame.id))} className="rounded border border-stroke px-2 py-1">选择前 12 张</button><button type="button" onClick={() => choose([])} className="rounded border border-stroke px-2 py-1">清空选择</button></div>
      <p className="text-ink-faint">预算选择保留首尾上下文，优先分散的本地变化点；只改变勾选，不发送截图，仍需你确认。</p>
      <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto">
        {indexedFrames.map((frame) => {
          const speech = transcriptFor(frame.windowStart, frame.windowEnd);
          return <article key={frame.id} className={`space-y-1 rounded border p-1.5 ${selected.has(frame.id) ? 'border-cyan-300' : 'border-stroke'}`}>
            <label className="flex gap-1"><input type="checkbox" checked={selected.has(frame.id)} onChange={(event) => toggleFrameSelection(frame.id, event.target.checked)} />送入候选分析</label>
            <button type="button" onClick={() => onSeek(frame.time)} className="w-full text-left text-cyan-200">{clock(frame.time)} · {frame.id.startsWith('coverage-gap-') ? '空档局部补抽' : frame.reason === 'change' ? '画面变化附近' : '定期覆盖'}</button>
            <img src={frame.image} alt={`${clock(frame.time)} 的原片代表截图`} loading="lazy" className="w-full rounded" />
            <p>{clock(frame.windowStart)}–{clock(frame.windowEnd)} 的口播：{speech || '暂无带时间码口播'}</p>
          </article>;
        })}
      </div>
      <div className="space-y-1 rounded border border-amber-300/25 p-2">
        <p>{selectedProvider?.local ? '即将交给本机端点：' : '即将发送：'}{selected.size} 张低分辨率截图{includeTranscript ? '及对应口播文字' : '，不含口播文字'}。原视频不会上传。单次最多 12 张。</p>
        <p>本次负载：{selectedPayload.imageCount} 张 · 图片 {bytesLabel(selectedPayload.imageBytes)} · 口播 {selectedPayload.transcriptCharacters} 字{includeTranscript ? '' : '（未发送）'} · 时间跨度 {selectedPayload.spanSeconds.toFixed(1)} 秒</p>
        {selected.size > 0 && <div className="flex flex-wrap items-center gap-2"><span>最长证据点空档：{selectedCoverage.largestGap.seconds.toFixed(1)} 秒（{clock(selectedCoverage.largestGap.start)}–{clock(selectedCoverage.largestGap.end)}）</span>{coverageSuggestion && selected.size < 12 && <button type="button" onClick={() => choose([...selected, coverageSuggestion.id])} className="rounded border border-violet-300/30 px-2 py-1 text-violet-100">补选空档中点附近 {clock(coverageSuggestion.time)}</button>}{coverageTargetPlan && coverageTargetPlan.addedIds.length > 0 && <button type="button" onClick={() => choose(coverageTargetPlan.selectedIds)} className="rounded border border-emerald-300/30 px-2 py-1 text-emerald-100">按 {coverageGapTarget} 秒目标补齐到 {coverageTargetPlan.selectedIds.length} 张（预计 {coverageTargetPlan.after.largestGap.seconds.toFixed(1)} 秒）</button>}{coveragePlan && coveragePlanPayload && coveragePlan.addedIds.length > 0 && <button type="button" onClick={() => choose(coveragePlan.selectedIds)} className="rounded border border-violet-300/30 px-2 py-1 text-violet-100">按剩余预算补齐到 {coveragePlan.selectedIds.length} 张（空档 {coveragePlan.after.largestGap.seconds.toFixed(1)} 秒）</button>}<span className="text-ink-faint">只按截图时间提示未观察区间，不判断区间内是否真的发生动作。</span>{coverageTargetPlan && coverageTargetPlanPayload && coverageTargetPlan.addedIds.length > 0 && <span className="text-emerald-200">目标方案预计增加 {coverageTargetPlanPayload.imageCount - selectedPayload.imageCount} 张 / {bytesLabel(coverageTargetPlanPayload.imageBytes - selectedPayload.imageBytes)} / 口播 {coverageTargetPlanPayload.transcriptCharacters - selectedPayload.transcriptCharacters} 字。</span>}{coveragePlan && coveragePlanPayload && coveragePlan.addedIds.length > 0 && <span className="text-ink-faint">用满预算预计增加 {coveragePlanPayload.imageCount - selectedPayload.imageCount} 张 / {bytesLabel(coveragePlanPayload.imageBytes - selectedPayload.imageBytes)} / 口播 {coveragePlanPayload.transcriptCharacters - selectedPayload.transcriptCharacters} 字。</span>}</div>}
        {coverageTargetStatus && <p className={coverageTargetStatus.met ? 'text-emerald-200' : 'text-amber-200'}>目标可达性：{coverageTargetStatus.text}</p>}
        {selected.size > 0 && selectedCoverage.largestGap.seconds > coverageGapTarget && coverageTargetPlan?.after.largestGap.seconds !== undefined && coverageTargetPlan.after.largestGap.seconds > coverageGapTarget && remainingImageBudget > 0 && <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={coverageBusy || busy || analyzing || selectedCoverage.largestGap.seconds < 0.2} onClick={() => void generateCoverageSupplements()} className="rounded border border-violet-300/30 px-2 py-1 text-violet-100 disabled:opacity-40">{coverageBusy ? '正在本地补抽空档…' : `在最大空档本地补抽 ${Math.min(6, Math.max(2, remainingImageBudget))} 张`}</button><span className="text-ink-faint">只读取 {clock(selectedCoverage.largestGap.start)}–{clock(selectedCoverage.largestGap.end)}，不调用模型；补抽帧先进入候选列表，由你或目标方案再选择。</span></div>}
        <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={selected.size < 1 || preflightBusy || busy || analyzing} onClick={() => void preflightSelectedFrames()} className="rounded border border-cyan-300/30 px-2 py-1 text-cyan-100 disabled:opacity-40">{preflightBusy ? '正在本地预检…' : '本地检查重复/相似'}</button><span className="text-ink-faint">只解码当前截图并计算指纹，不需要上传确认，不调用模型，也不计入会话用量。</span></div>
        {preflightSummary && <p className="text-cyan-100">{preflightSummary}</p>}
        <div className="text-ink-faint"><p>当前面板会话已发起：{sessionUsage.requests} 次请求 · {sessionUsage.imageCount} 张 · 图片 {bytesLabel(sessionUsage.imageBytes)} · 口播 {sessionUsage.transcriptCharacters} 字。</p>{sessionTokenUsage.length ? <><p>模型服务报告 token（按提供方和模型分开）：</p>{sessionTokenUsage.map((bucket) => <p key={`${bucket.providerId}|${bucket.model}`}>{bucket.provider} / {bucket.model}：{bucket.reportedRequests} 次 · 输入 {bucket.inputTokens} / 输出 {bucket.outputTokens} / 合计 {bucket.totalTokens}</p>)}</> : <p>模型服务尚未返回 token 用量。</p>}<p>只显示实际负载与服务报告值，不推算账单金额。</p></div>
        <fieldset className="grid grid-cols-4 gap-1 rounded border border-amber-300/15 p-1.5"><legend className="px-1 text-amber-100">当前面板会话预算</legend><label>请求上限<input aria-label="视觉请求上限" type="number" min="1" max="100" value={sessionBudget.maxRequests} onChange={(event) => setSessionBudget((current) => ({ ...current, maxRequests: Math.min(100, Math.max(1, Math.floor(Number(event.target.value) || 1))) }))} className={field} /></label><label>图片上限<input aria-label="视觉图片上限" type="number" min="1" max="1200" value={sessionBudget.maxImages} onChange={(event) => setSessionBudget((current) => ({ ...current, maxImages: Math.min(1200, Math.max(1, Math.floor(Number(event.target.value) || 1))) }))} className={field} /></label><label>图片 MB 上限<input aria-label="视觉图片容量上限" type="number" min="0.01" max="512" step="0.01" value={sessionBudget.maxImageBytes / 1024 / 1024} onChange={(event) => setSessionBudget((current) => ({ ...current, maxImageBytes: Math.min(512, Math.max(0.01, Number(event.target.value) || 0.01)) * 1024 * 1024 }))} className={field} /></label><label>单模型 Token 停止线<input aria-label="单模型已报告 Token 停止线" type="number" min="1" max="10000000" step="100" value={sessionBudget.maxReportedTokensPerModel} onChange={(event) => setSessionBudget((current) => ({ ...current, maxReportedTokensPerModel: Math.min(10000000, Math.max(1, Math.floor(Number(event.target.value) || 1))) }))} className={field} /></label><p className="col-span-4 text-ink-faint">请求、图片和容量会在预计超限时阻止；Token 只能在当前模型已报告累计达到停止线后阻止下一次，单次请求仍可能越线，未返回 usage 时无法按 Token 控制。关闭面板后预算和累计归零。</p></fieldset>
        <label className="block rounded border border-emerald-300/15 p-1.5">证据最大空档目标（秒）<input aria-label="视觉证据最大空档目标秒数" type="number" min="1" max="600" value={coverageGapTarget} onChange={(event) => setCoverageGapTarget(Math.min(600, Math.max(1, Math.floor(Number(event.target.value) || 1))))} className={`${field} ml-1 w-24`} /><span className="ml-2 text-ink-faint">目标补齐达到该空档后立即停止；若现有代表帧或剩余图片额度不足，会显示实际可达到的结果。</span></label>
        <label className="block rounded border border-orange-300/15 p-1.5">高度相似预警阈值（0–16）<input aria-label="感知哈希相似距离阈值" type="number" min="0" max="16" value={similarityThreshold} onChange={(event) => { setSimilarityThreshold(Math.min(16, Math.max(0, Math.floor(Number(event.target.value) || 0)))); setSimilarFrameApproval(undefined); setPreflightSummary(''); }} className={`${field} ml-1 w-20`} /><span className="ml-2 text-ink-faint">当前距离不超过 {similarityThreshold}/64 时预警；数值越小越严格。完全重复 SHA-256 检查不受影响。</span></label>
        <details className="rounded border border-amber-300/15 p-1.5"><summary>本次会话模型请求记录（{requestHistory.length}）</summary><div className="mt-1 space-y-1">{[...requestHistory].reverse().map((record) => <article key={record.requestId} className="rounded border border-stroke p-1 text-ink-faint"><p className={record.status === 'succeeded' ? 'text-emerald-200' : 'text-red-200'}>第 {record.sessionRequestNumber} 次 · {record.pass === 'refinement' ? '补帧复核' : '初次分析'} · {record.status === 'succeeded' ? '成功' : '失败'}</p><p>{record.provider} / {record.model} · {record.payload.imageCount} 张 · {bytesLabel(record.payload.imageBytes)} · 口播 {record.payload.transcriptCharacters} 字</p><p>{record.tokenUsage ? `服务报告 Token：输入 ${record.tokenUsage.inputTokens} / 输出 ${record.tokenUsage.outputTokens} / 合计 ${record.tokenUsage.totalTokens}` : '服务未返回 Token 用量'}</p>{record.duplicateFrameReview && <p className="text-amber-200">完全重复截图已由用户确认 · {record.duplicateFrameReview.confirmedAt} · {record.duplicateFrameReview.groups.length} 组</p>}{record.error && <p className="text-red-200">{record.error}</p>}<p className="break-all">{record.requestId} · {record.requestedAt}</p></article>)}</div><div className="mt-1 flex flex-wrap items-center gap-2"><button type="button" disabled={!requestHistory.length} onClick={() => void downloadRequestHistory()} className="rounded border border-amber-300/30 px-2 py-1 text-amber-100 disabled:opacity-40">下载请求记录 JSON</button><label className="rounded border border-stroke px-2 py-1">验证请求记录 JSON<input aria-label="验证视觉请求记录 JSON" type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const input = event.currentTarget; void verifyRequestHistoryFile(input.files?.[0]).finally(() => { input.value = ''; }); }} /></label></div>{requestLogVerification && <p className={`mt-1 break-all ${requestLogVerification.ok ? 'text-emerald-200' : 'text-red-200'}`}>{requestLogVerification.message}</p>}<p className="mt-1 text-ink-faint">只保留当前面板最近 100 次真实调用的元数据，不保存图片或口播正文；预算拦截不会写成模型请求。导出包含帧指纹、重复截图人工确认凭证和记录段 SHA-256，不包含密钥或端点地址。验证只读，不导入记录或修改工程。</p></details>
        {requestHistory.some((record) => record.similarFrameReview) && <p className="text-orange-200">本次会话已有 {requestHistory.filter((record) => record.similarFrameReview).length} 次请求携带高度相似截图人工确认凭证；详情已写入下载记录与最终动作回执。</p>}
        <label className="block"><input aria-label="发送对应口播文字" type="checkbox" checked={includeTranscript} onChange={(event) => { setIncludeTranscript(event.target.checked); setUploadConfirmed(false); setCandidates([]); setSequences([]); setAnalyzedFrames([]); setAnalysisContext(undefined); setRefinements({}); setDuplicateFrameApproval(undefined); setSimilarFrameApproval(undefined); setError(''); }} /> 发送所选截图时间窗内的口播文字</label>
        {providerOptions.length > 0 && <label>分析模型<select aria-label="视觉模型提供方" value={providerId} onChange={(event) => { setProviderId(event.target.value as VisualUnderstandingProviderCapability['id']); setUploadConfirmed(false); setCandidates([]); setSequences([]); setAnalyzedFrames([]); setAnalysisContext(undefined); setRefinements({}); setDuplicateFrameApproval(undefined); setSimilarFrameApproval(undefined); setProbe(undefined); setError(''); }} className="ml-1 rounded border border-stroke bg-panel px-1 py-1 text-ink">{providerOptions.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.provider} · {provider.model || '未配置'}{provider.available ? '' : '（不可用）'}</option>)}</select></label>}
        {providerOptions.find((provider) => provider.id === 'local-openai')?.configurationError && <p className="text-red-200">本机配置错误：{providerOptions.find((provider) => provider.id === 'local-openai')?.configurationError}</p>}
        <p>{selectedProvider?.available ? `${selectedProvider.provider} · ${selectedProvider.model}${selectedProvider.local ? ' · 截图只发往本机回环地址' : ''}` : selectedProvider?.configurationError || '未配置可用视觉模型：在线模式需要 OPENAI_API_KEY；本机模式需要 HYPERFRAMES_LOCAL_VISION_MODEL。'}</p>
        {selectedProvider?.local && <div className="flex items-center gap-2"><button type="button" disabled={!selectedProvider.available} onClick={() => void probeProvider()} className="rounded border border-cyan-300/30 px-2 py-1 text-cyan-100 disabled:opacity-40">检测本机端点</button>{probe && <span className={probe.ok && probe.modelFound !== false ? 'text-emerald-200' : 'text-amber-200'}>{probe.message}</span>}</div>}
        <label className="block"><input type="checkbox" checked={uploadConfirmed} onChange={(event) => setUploadConfirmed(event.target.checked)} /> 我确认发送所选截图{includeTranscript ? '和口播文字' : ''}进行分析</label>
        <button type="button" disabled={!selectedProvider?.available || selected.size < 1 || !uploadConfirmed || analyzing} onClick={() => void analyze()} className="rounded bg-amber-500 px-2 py-1 font-medium text-slate-950 disabled:opacity-40">{analyzing ? '正在生成候选描述…' : `分析所选 ${selected.size} 张`}</button>
      </div>
      {candidates.length > 0 && <div className="space-y-2"><h5 className="font-semibold text-cyan-100">待人工审核的视觉候选</h5>{candidates.map((candidate) => {
        const frame = analyzedFrames.find((item) => item.id === candidate.frameId);
        if (!frame) return null;
        return <article key={candidate.frameId} className="space-y-1.5 rounded border border-stroke p-2">
          <button type="button" className="text-cyan-200" onClick={() => onSeek(frame.time)}>{clock(frame.windowStart)}–{clock(frame.windowEnd)} · 回看原片</button>
          <div className="grid grid-cols-2 gap-1"><input aria-label="候选主体" className={field} value={candidate.subject} onChange={(event) => patchCandidate(candidate.frameId, { subject: event.target.value, reviewed: false })} placeholder="主体" /><input aria-label="候选动作" className={field} value={candidate.action} onChange={(event) => patchCandidate(candidate.frameId, { action: event.target.value, reviewed: false })} placeholder="动作（必填）" /><input aria-label="候选对象" className={field} value={candidate.object} onChange={(event) => patchCandidate(candidate.frameId, { object: event.target.value, reviewed: false })} placeholder="对象" /><input aria-label="候选结果" className={field} value={candidate.result} onChange={(event) => patchCandidate(candidate.frameId, { result: event.target.value, reviewed: false })} placeholder="结果" /></div>
          <div className="grid grid-cols-3 gap-1"><select aria-label="候选景别" className={field} value={candidate.shot} onChange={(event) => patchCandidate(candidate.frameId, { shot: event.target.value as CandidateDraft['shot'], reviewed: false })}>{Object.entries(actionShotLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="候选决定" className={field} value={candidate.kind} onChange={(event) => patchCandidate(candidate.frameId, { kind: event.target.value as SourceEventMarkerKind, reviewed: false })}><option value="action">动作</option><option value="highlight">重点保留</option><option value="exclude">明确不要</option></select><input aria-label="候选标签" className={field} value={candidate.tags.join('，')} onChange={(event) => patchCandidate(candidate.frameId, { tags: event.target.value.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean), reviewed: false })} placeholder="标签" /></div>
          <p>模型置信度 {(candidate.confidence * 100).toFixed(0)}%{candidate.uncertainty ? ` · 不确定：${candidate.uncertainty}` : ''}</p>
          <label className="block"><input type="checkbox" checked={candidate.reviewed} onChange={(event) => patchCandidate(candidate.frameId, { reviewed: event.target.checked })} /> 我已回看该时间窗并确认描述与边界</label>
          <button type="button" disabled={!candidate.reviewed || !candidate.action.trim() || candidate.saved} onClick={() => accept(candidate)} className="rounded border border-emerald-300/30 px-2 py-1 text-emerald-200 disabled:opacity-40">{candidate.saved ? '已加入人工索引' : '确认并加入动作索引'}</button>
        </article>;
      })}</div>}
      {sequences.length > 0 && <div className="space-y-2"><h5 className="font-semibold text-violet-100">待人工审核的跨帧状态变化</h5><p className="text-ink-faint">只表示所选截图之间可见的前后差异，不证明间隔中的连续动作或因果。</p>{sequences.map((sequence) => {
        const referenced = sequence.frameIds.map((id) => analyzedFrames.find((frame) => frame.id === id)).filter((frame) => Boolean(frame));
        if (referenced.length !== sequence.frameIds.length) return null;
        const first = referenced[0]!; const last = referenced[referenced.length - 1]!;
        const key = sequenceKey(sequence.frameIds); const refinement = refinements[key];
        const supplementalFrameBudget = selectVisualRefinementBudget(Math.max(0, sessionBudget.maxImages - sessionUsage.imageCount), sequence.frameIds.length);
        const refinementPayload = refinement?.result ? summarizeVisualUnderstandingPayload([
          ...referenced.map((frame) => ({ ...frame!, transcript: analysisTranscriptFor(frame!.windowStart, frame!.windowEnd) })),
          ...refinement.result.frames.map((frame, index) => ({ id: `refine-${index + 1}`, time: frame.time, windowStart: frame.windowStart, windowEnd: frame.windowEnd, image: frame.image, transcript: analysisTranscriptFor(frame.windowStart, frame.windowEnd) })),
        ]) : undefined;
        return <article key={key} className="space-y-1.5 rounded border border-violet-300/25 bg-violet-300/[0.03] p-2">
          <button type="button" className="text-violet-200" onClick={() => onSeek(first.windowStart)}>{clock(first.windowStart)}–{clock(last.windowEnd)} · {sequence.frameIds.length} 张连续截图 · 回看完整区间</button>
          <p>连续性：{sequence.continuity === 'state-change' ? '只确认前后状态变化' : sequence.continuity === 'possible-continuation' ? '可能延续，尚未证实' : '无法判断连续性'} · 置信度 {(sequence.confidence * 100).toFixed(0)}%</p>
          {sequence.evidence && <p>可见证据：{sequence.evidence}</p>}{sequence.uncertainty && <p className="text-amber-200">不确定：{sequence.uncertainty}</p>}
          {sequence.refinementComparison && <div className={`rounded border p-1.5 ${sequence.refinementComparison.status === 'changed' ? 'border-amber-300/35 bg-amber-300/[0.04]' : 'border-emerald-300/25 bg-emerald-300/[0.03]'}`}>
            <p className={sequence.refinementComparison.status === 'changed' ? 'text-amber-200' : 'text-emerald-200'}>{sequence.refinementComparison.status === 'changed' ? `补帧前后结论有分歧：${sequence.refinementComparison.changedFields.map((field) => ({ action: '动作', result: '结果', continuity: '连续性', 'change-windows': '变化窗' })[field]).join('、')}` : '补帧前后关键结论一致'}</p>
            <p>初次：{sequence.refinementComparison.initial.action || '未描述动作'} · {sequence.refinementComparison.initial.result || '未描述结果'} · {(sequence.refinementComparison.initial.confidence * 100).toFixed(0)}%</p>
            <p>补帧：{sequence.refinementComparison.refined.action || '未描述动作'} · {sequence.refinementComparison.refined.result || '未描述结果'} · {(sequence.refinementComparison.refined.confidence * 100).toFixed(0)}%</p>
            <p className="text-ink-faint">这里只提示两轮模型是否一致，不自动判断哪一轮正确；请结合完整区间回看后填写最终字段。</p>
            {sequence.refinementComparison.status === 'changed' && <label className="mt-1 block"><input type="checkbox" checked={sequence.disagreementAcknowledged} onChange={(event) => patchSequence(sequence.frameIds, { disagreementAcknowledged: event.target.checked, reviewed: false })} /> 我已核对两轮分歧，并以上方人工字段作为最终结论</label>}
          </div>}
          <div className="space-y-1 rounded border border-violet-300/15 p-1.5"><p className="font-medium text-violet-100">相邻证据帧的变化定位</p>{sequence.changeWindows.map((window) => {
            const before = referenced.find((frame) => frame?.id === window.beforeFrameId)!;
            const after = referenced.find((frame) => frame?.id === window.afterFrameId)!;
            const assessment = window.assessment === 'visible-change' ? '可见变化' : window.assessment === 'possible-change' ? '可能变化' : '未见明确变化';
            return <button type="button" key={`${window.beforeFrameId}|${window.afterFrameId}`} onClick={() => onSeek(before.time)} className="block w-full rounded border border-violet-300/10 px-1.5 py-1 text-left hover:border-violet-300/30">
              <span className="text-violet-200">{clock(before.time)}–{clock(after.time)} · {assessment} · {(window.confidence * 100).toFixed(0)}%</span>
              {window.evidence && <span className="block">{window.evidence}</span>}{window.uncertainty && <span className="block text-amber-200">疑点：{window.uncertainty}</span>}
            </button>;
          })}<p className="text-ink-faint">区间只表示变化位于两张证据帧之间；点击可从前一帧时间回看，不能证明中间过程。</p></div>
          <div className="space-y-1 rounded border border-cyan-300/20 p-1.5"><div className="flex items-center gap-2"><button type="button" disabled={analyzing || refinement?.busy || last.time - first.time < 0.2 || supplementalFrameBudget < 2} onClick={() => void generateRefinement(sequence)} className="rounded border border-cyan-300/30 px-2 py-1 text-cyan-100 disabled:opacity-40">{refinement?.busy ? '正在本机补帧…' : refinement?.result ? `按剩余预算重新补抽 ${supplementalFrameBudget} 张` : `按剩余预算补抽 ${supplementalFrameBudget} 张`}</button><span className="text-ink-faint">只读取 {clock(first.time)}–{clock(last.time)}，不扫描区间外画面</span></div>
          {supplementalFrameBudget < 2 && <p className="text-amber-200">剩余图片预算不足：需保留 {sequence.frameIds.length} 张原证据并至少补抽 2 张。请提高图片上限。</p>}
          {refinement?.error && <p className="text-red-200">{refinement.error}</p>}
          {refinement?.result && <><div className="grid grid-cols-3 gap-1">{refinement.result.frames.map((frame, index) => <button type="button" key={`${frame.time}-${index}`} onClick={() => onSeek(frame.time)} className="space-y-0.5 text-left text-cyan-200"><img src={frame.image} alt={`${clock(frame.time)} 的补充截图`} className="w-full rounded" /><span>{clock(frame.time)}</span></button>)}</div>{refinementPayload && <p>第二轮负载：{refinementPayload.imageCount} 张 · 图片 {bytesLabel(refinementPayload.imageBytes)} · 口播 {refinementPayload.transcriptCharacters} 字 · 时间跨度 {refinementPayload.spanSeconds.toFixed(1)} 秒</p>}<p className="text-ink-faint">补帧仅用于缩小变化发生范围；第二轮仍不能证明帧间连续动作。</p><label className="block"><input type="checkbox" checked={refinement.confirmed} onChange={(event) => setRefinements((current) => ({ ...current, [key]: { ...current[key], confirmed: event.target.checked } }))} /> 我确认把原证据截图和这 {refinement.result.frames.length} 张补充截图交给当前模型进行第二轮分析</label><button type="button" disabled={!refinement.confirmed || analyzing} onClick={() => void analyzeRefinement(sequence)} className="rounded border border-violet-300/30 px-2 py-1 text-violet-100 disabled:opacity-40">{analyzing ? '正在细化分析…' : '用补充帧再次分析'}</button></>}
          </div>
          <div className="grid grid-cols-2 gap-1"><input aria-label="跨帧主体" className={field} value={sequence.subject} onChange={(event) => patchSequence(sequence.frameIds, { subject: event.target.value, reviewed: false })} placeholder="主体" /><input aria-label="跨帧动作" className={field} value={sequence.action} onChange={(event) => patchSequence(sequence.frameIds, { action: event.target.value, reviewed: false })} placeholder="人工确认后的动作" /><input aria-label="跨帧对象" className={field} value={sequence.object} onChange={(event) => patchSequence(sequence.frameIds, { object: event.target.value, reviewed: false })} placeholder="对象" /><input aria-label="跨帧结果" className={field} value={sequence.result} onChange={(event) => patchSequence(sequence.frameIds, { result: event.target.value, reviewed: false })} placeholder="前后状态结果" /></div>
          <div className="grid grid-cols-3 gap-1"><select aria-label="跨帧景别" className={field} value={sequence.shot} onChange={(event) => patchSequence(sequence.frameIds, { shot: event.target.value as SequenceDraft['shot'], reviewed: false })}>{Object.entries(actionShotLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="跨帧决定" className={field} value={sequence.kind} onChange={(event) => patchSequence(sequence.frameIds, { kind: event.target.value as SourceEventMarkerKind, reviewed: false })}><option value="action">动作</option><option value="highlight">重点保留</option><option value="exclude">明确不要</option></select><input aria-label="跨帧标签" className={field} value={sequence.tags.join('，')} onChange={(event) => patchSequence(sequence.frameIds, { tags: event.target.value.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean), reviewed: false })} placeholder="标签" /></div>
          <label className="block"><input type="checkbox" checked={sequence.reviewed} onChange={(event) => patchSequence(sequence.frameIds, { reviewed: event.target.checked })} /> 我已观看从第一张到最后一张之间的完整视频，并确认动作与边界</label>
          <button type="button" disabled={!sequence.reviewed || !sequence.action.trim() || sequence.saved || (sequence.refinementComparison?.status === 'changed' && !sequence.disagreementAcknowledged)} onClick={() => acceptSequence(sequence)} className="rounded border border-emerald-300/30 px-2 py-1 text-emerald-200 disabled:opacity-40">{sequence.saved ? '已加入人工索引' : '确认并加入跨帧索引'}</button>
        </article>;
      })}</div>}
      <p>模型描述始终是候选；只有回看原片并确认的条目才会进入动作索引，原有切点和发布门禁保持不变。</p>
    </>}
  </section>;
}
