import assert from 'node:assert/strict';
import { analyzeSourceVisualFrames, getSourceVisualUnderstandingCapabilities, probeSourceVisualUnderstandingProvider } from '../electron/sourceVisualUnderstanding';
import { addVisualUnderstandingTokenUsage, compareVisualUnderstandingAdjacentFrames, compareVisualUnderstandingSequences, createVisualUnderstandingRequestLog, duplicateVisualUnderstandingFrameGroups, fingerprintVisualUnderstandingFrames, normalizeVisualUnderstandingCandidates, normalizeVisualUnderstandingSequences, planVisualUnderstandingCoverageSelection, previewVisualUnderstandingRepresentativeSelection, recommendVisualUnderstandingCoverageOption, selectVisualUnderstandingRepresentatives, similarVisualUnderstandingFramePairs, summarizeVisualUnderstandingCoverage, summarizeVisualUnderstandingPayload, validateVisualUnderstandingFrames, verifyVisualUnderstandingRequestLog, visualUnderstandingBudgetViolations, visualUnderstandingPerceptualDistance, visualUnderstandingPerceptualHash, visualUnderstandingTokenStop, type VisualUnderstandingFrame, type VisualUnderstandingRequestRecord } from '../src/lib/sourceVisualUnderstanding';

const image = `data:image/jpeg;base64,${Buffer.from('jpeg-test').toString('base64')}`;
const frames: VisualUnderstandingFrame[] = [
  { id: 'frame-1', time: 5, windowStart: 0, windowEnd: 10, image, transcript: '把杯子放到桌上' },
  { id: 'frame-2', time: 15, windowStart: 10, windowEnd: 20, image, transcript: '杯子已经放稳' },
];
validateVisualUnderstandingFrames(frames);
assert.deepEqual(summarizeVisualUnderstandingPayload(frames), { imageCount: 2, imageBytes: 18, transcriptCharacters: 13, spanSeconds: 20 });
assert.deepEqual(summarizeVisualUnderstandingCoverage(frames, 30), { selectedCount: 2, largestGap: { start: 15, end: 30, seconds: 15 } });
assert.deepEqual(summarizeVisualUnderstandingCoverage([], 30), { selectedCount: 0, largestGap: { start: 0, end: 30, seconds: 30 } });
assert.throws(() => summarizeVisualUnderstandingCoverage([{ id: 'bad', time: 31 }], 30), /时间无效/);
const coveragePlan = planVisualUnderstandingCoverageSelection([{ id: 'a', time: 5 }, { id: 'b', time: 15 }, { id: 'c', time: 25 }], ['a'], 30, 3);
assert.deepEqual(coveragePlan.selectedIds, ['a', 'b', 'c']);
assert.deepEqual(coveragePlan.addedIds, ['b', 'c']);
assert.equal(coveragePlan.before.largestGap.seconds, 25);
assert.equal(coveragePlan.after.largestGap.seconds, 10);
const targetCoveragePlan = planVisualUnderstandingCoverageSelection([{ id: 'a', time: 5 }, { id: 'b', time: 15 }, { id: 'c', time: 25 }], ['a'], 30, 3, 15);
assert.deepEqual(targetCoveragePlan.addedIds, ['b']);
assert.equal(targetCoveragePlan.after.largestGap.seconds, 15);
assert.throws(() => planVisualUnderstandingCoverageSelection([{ id: 'a', time: 5 }], ['a'], 30, 1, -1), /秒数目标无效/);
assert.throws(() => planVisualUnderstandingCoverageSelection([{ id: 'a', time: 5 }], ['missing'], 30, 1), /未知截图/);
assert.deepEqual(recommendVisualUnderstandingCoverageOption(25, [
  { id: 'a', resultingLargestGapSeconds: 20, addedImageCount: 2, addedImageBytes: 100 },
  { id: 'b', resultingLargestGapSeconds: 15, addedImageCount: 3, addedImageBytes: 60 },
  { id: 'c', resultingLargestGapSeconds: 15, addedImageCount: 2, addedImageBytes: 120 },
  { id: 'd', resultingLargestGapSeconds: 15, addedImageCount: 2, addedImageBytes: 80 },
]), { id: 'd', resultingLargestGapSeconds: 15, addedImageCount: 2, addedImageBytes: 80, index: 3, gapReductionSeconds: 10 });
assert.equal(recommendVisualUnderstandingCoverageOption(10, [{ id: 'same', resultingLargestGapSeconds: 10, addedImageCount: 1, addedImageBytes: 1 }]), undefined);
assert.equal(recommendVisualUnderstandingCoverageOption(5, [{ id: 'rounding', resultingLargestGapSeconds: 4.96, addedImageCount: 1, addedImageBytes: 1 }]), undefined);
assert.throws(() => recommendVisualUnderstandingCoverageOption(10, [{ id: 'bad', resultingLargestGapSeconds: 5, addedImageCount: -1, addedImageBytes: 1 }]), /比较数据无效/);
const fingerprints = await fingerprintVisualUnderstandingFrames(frames);
assert.deepEqual(fingerprints.map(({ id, time }) => ({ id, time })), [{ id: 'frame-1', time: 5 }, { id: 'frame-2', time: 15 }]);
assert.match(fingerprints[0].sha256, /^[a-f0-9]{64}$/);
assert.equal(fingerprints[0].sha256, fingerprints[1].sha256, '相同 JPEG 字节必须产生相同指纹');
assert.deepEqual(duplicateVisualUnderstandingFrameGroups(fingerprints).map((group) => group.frames.map((frame) => frame.id)), [['frame-1', 'frame-2']]);
assert.deepEqual(duplicateVisualUnderstandingFrameGroups([{ ...fingerprints[0] }, { ...fingerprints[1], sha256: 'f'.repeat(64) }]), []);
const gradient = (descending: boolean) => Uint8ClampedArray.from({ length: 9 * 8 * 4 }, (_, offset) => {
  const channel = offset % 4; if (channel === 3) return 255;
  const x = Math.floor(offset / 4) % 9; return (descending ? 8 - x : x) * 28;
});
assert.equal(visualUnderstandingPerceptualHash(gradient(false)), '0000000000000000');
assert.equal(visualUnderstandingPerceptualHash(gradient(true)), 'ffffffffffffffff');
assert.equal(visualUnderstandingPerceptualDistance('0000000000000000', '0000000000000001'), 1);
assert.deepEqual(compareVisualUnderstandingAdjacentFrames([
  { id: 'later', time: 3, sha256: 'b'.repeat(64), perceptualHash: '0000000000000003' },
  { id: 'first', time: 1, sha256: 'a'.repeat(64), perceptualHash: '0000000000000000' },
  { id: 'middle', time: 2, sha256: 'c'.repeat(64), perceptualHash: '0000000000000001' },
]).map((pair) => [pair.first.id, pair.second.id, pair.hammingDistance]), [['first', 'middle', 1], ['middle', 'later', 1]]);
assert.throws(() => compareVisualUnderstandingAdjacentFrames([{ id: 'missing-hash', time: 1, sha256: 'a'.repeat(64) }]), /数据无效/);
assert.throws(() => compareVisualUnderstandingAdjacentFrames([
  { id: 'first', time: 1, sha256: 'a'.repeat(64), perceptualHash: '0'.repeat(16) },
  { id: 'second', time: 1, sha256: 'b'.repeat(64), perceptualHash: 'f'.repeat(16) },
]), /严格递增/);
assert.deepEqual(similarVisualUnderstandingFramePairs([
  { ...fingerprints[0], perceptualHash: '0000000000000000' },
  { ...fingerprints[1], sha256: 'f'.repeat(64), perceptualHash: '0000000000000001' },
]).map((pair) => pair.hammingDistance), [1]);
assert.deepEqual(similarVisualUnderstandingFramePairs([
  { ...fingerprints[0], perceptualHash: '0000000000000000' },
  { ...fingerprints[1], sha256: 'f'.repeat(64), perceptualHash: '0000000000000001' },
], 0), []);
assert.deepEqual(similarVisualUnderstandingFramePairs([
  { ...fingerprints[0], perceptualHash: '0000000000000000' },
  { ...fingerprints[1], sha256: 'f'.repeat(64), perceptualHash: 'ffffffffffffffff' },
]), []);
assert.deepEqual(selectVisualUnderstandingRepresentatives(['a', 'b', 'c'], [{ firstFrameId: 'a', secondFrameId: 'b' }, { firstFrameId: 'b', secondFrameId: 'c' }]), { keptIds: ['a', 'c'], removedIds: ['b'] });
assert.deepEqual(selectVisualUnderstandingRepresentatives(['a', 'b', 'c'], [{ firstFrameId: 'c', secondFrameId: 'a' }]), { keptIds: ['a', 'b'], removedIds: ['c'] });
assert.throws(() => selectVisualUnderstandingRepresentatives(['a', 'a'], []), /编号无效/);
assert.throws(() => selectVisualUnderstandingRepresentatives(['a'], [{ firstFrameId: 'a', secondFrameId: 'missing' }]), /未知/);
const representativePreview = previewVisualUnderstandingRepresentativeSelection(frames, [{ firstFrameId: 'frame-1', secondFrameId: 'frame-2' }]);
assert.deepEqual(representativePreview.keptIds, ['frame-1']);
assert.deepEqual(representativePreview.before, { imageCount: 2, imageBytes: 18, transcriptCharacters: 13, spanSeconds: 20 });
assert.deepEqual(representativePreview.after, { imageCount: 1, imageBytes: 9, transcriptCharacters: 7, spanSeconds: 10 });
assert.deepEqual(representativePreview.saved, { imageCount: 1, imageBytes: 9, transcriptCharacters: 6 });
assert.rejects(() => fingerprintVisualUnderstandingFrames([{ ...frames[0], image: 'data:image/png;base64,AA==' }]), /JPEG/);
assert.deepEqual(summarizeVisualUnderstandingPayload([]), { imageCount: 0, imageBytes: 0, transcriptCharacters: 0, spanSeconds: 0 });
const emptyUsage = { requests: 0, imageCount: 0, imageBytes: 0, transcriptCharacters: 0 };
const payload = summarizeVisualUnderstandingPayload(frames);
assert.deepEqual(visualUnderstandingBudgetViolations(emptyUsage, payload, { maxRequests: 1, maxImages: 2, maxImageBytes: 18, maxReportedTokensPerModel: 1000 }), []);
assert.match(visualUnderstandingBudgetViolations({ ...emptyUsage, requests: 1 }, payload, { maxRequests: 1, maxImages: 20, maxImageBytes: 100, maxReportedTokensPerModel: 1000 })[0], /请求次数/);
assert.match(visualUnderstandingBudgetViolations({ ...emptyUsage, imageCount: 1 }, payload, { maxRequests: 5, maxImages: 2, maxImageBytes: 100, maxReportedTokensPerModel: 1000 })[0], /图片数量/);
assert.match(visualUnderstandingBudgetViolations({ ...emptyUsage, imageBytes: 1 }, payload, { maxRequests: 5, maxImages: 20, maxImageBytes: 18, maxReportedTokensPerModel: 1000 })[0], /图片负载/);
assert.throws(() => validateVisualUnderstandingFrames([]), /1–12/);
assert.throws(() => validateVisualUnderstandingFrames([{ ...frames[0], image: 'https://example.com/a.jpg' }]), /JPEG/);
assert.throws(() => normalizeVisualUnderstandingCandidates({ candidates: [{ frameId: 'unknown' }] }, frames), /未知/);

const candidate = { frameId: 'frame-1', subject: '一只手', action: '拿着', object: '杯子', result: '', shot: 'closeup', tags: ['杯子'], uncertainty: '单帧无法确认是否放下', confidence: 0.72 };
assert.deepEqual(normalizeVisualUnderstandingCandidates({ candidates: [candidate] }, frames)[0], candidate);
const sequence = { frameIds: ['frame-1', 'frame-2'], subject: '一只手', action: '将杯子放到桌面', object: '杯子', result: '杯子从手中变为位于桌面', shot: 'closeup', tags: ['杯子', '状态变化'], continuity: 'state-change', evidence: '第一张手持杯子，第二张杯子位于桌面', uncertainty: '两帧之间的放置过程未被连续观察', confidence: 0.68, changeWindows: [{ beforeFrameId: 'frame-1', afterFrameId: 'frame-2', assessment: 'visible-change', evidence: '杯子位置不同', uncertainty: '具体发生时刻未知', confidence: 0.7 }] };
assert.deepEqual(normalizeVisualUnderstandingSequences({ sequences: [sequence] }, frames)[0], sequence);
assert.throws(() => normalizeVisualUnderstandingSequences({ sequences: [{ ...sequence, changeWindows: [] }] }, frames), /逐一说明/);
assert.throws(() => normalizeVisualUnderstandingSequences({ sequences: [{ ...sequence, changeWindows: [{ ...sequence.changeWindows[0], beforeFrameId: 'frame-2' }] }] }, frames), /相邻截图顺序/);
assert.throws(() => normalizeVisualUnderstandingSequences({ sequences: [{ ...sequence, changeWindows: [{ ...sequence.changeWindows[0], assessment: 'no-visible-change' }] }] }, frames), /至少需要一个可见变化区间/);
const sameComparison = compareVisualUnderstandingSequences(sequence, structuredClone(sequence));
assert.equal(sameComparison.status, 'consistent');
assert.deepEqual(sameComparison.changedFields, []);
const changedComparison = compareVisualUnderstandingSequences(sequence, { ...structuredClone(sequence), action: '杯子已经在桌面', continuity: 'uncertain', changeWindows: [{ ...sequence.changeWindows[0], assessment: 'possible-change' }] });
assert.equal(changedComparison.status, 'changed');
assert.deepEqual(changedComparison.changedFields, ['action', 'continuity', 'change-windows']);
assert.equal(changedComparison.initial.action, '将杯子放到桌面');
const thirdFrame = { ...frames[1], id: 'frame-3', time: 25, windowStart: 20, windowEnd: 30 };
assert.throws(() => normalizeVisualUnderstandingSequences({ sequences: [{ ...sequence, frameIds: ['frame-1', 'frame-3'] }] }, [...frames, thirdFrame]), /连续选择/);
assert.throws(() => validateVisualUnderstandingFrames([frames[1], frames[0]]), /严格递增/);

process.env.OPENAI_API_KEY = 'test-key';
let requestBody: Record<string, unknown> | undefined;
const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
  requestBody = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ usage: { input_tokens: 140, output_tokens: 30, total_tokens: 170 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ candidates: [candidate], sequences: [sequence] }) }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const result = await analyzeSourceVisualFrames(frames, 'openai', fetcher as typeof fetch);
assert.equal(result.imageCount, 2);
assert.equal(result.candidates[0].action, '拿着');
assert.equal(result.sequences?.[0].continuity, 'state-change');
assert.deepEqual(result.tokenUsage, { inputTokens: 140, outputTokens: 30, totalTokens: 170 });
const malformedUsageResult = await analyzeSourceVisualFrames(frames, 'openai', (async () => new Response(JSON.stringify({
  usage: { input_tokens: 140, output_tokens: 30, total_tokens: 999 },
  output: [{ content: [{ type: 'output_text', text: JSON.stringify({ candidates: [candidate], sequences: [sequence] }) }] }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch);
assert.equal(malformedUsageResult.tokenUsage, undefined, '自相矛盾的服务 usage 不得伪装成实际用量');
let usageBuckets = addVisualUnderstandingTokenUsage([], { providerId: 'openai', provider: 'OpenAI', model: 'vision-a' }, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
usageBuckets = addVisualUnderstandingTokenUsage(usageBuckets, { providerId: 'openai', provider: 'OpenAI', model: 'vision-a' }, { inputTokens: 80, outputTokens: 10, totalTokens: 90 });
usageBuckets = addVisualUnderstandingTokenUsage(usageBuckets, { providerId: 'local-openai', provider: '本机', model: 'vision-b' }, { inputTokens: 50, outputTokens: 5, totalTokens: 55 });
assert.deepEqual(usageBuckets.map(({ providerId, model, reportedRequests, totalTokens }) => ({ providerId, model, reportedRequests, totalTokens })), [
  { providerId: 'openai', model: 'vision-a', reportedRequests: 2, totalTokens: 210 },
  { providerId: 'local-openai', model: 'vision-b', reportedRequests: 1, totalTokens: 55 },
]);
assert.equal(visualUnderstandingTokenStop(usageBuckets, 'openai', 'vision-a', 211), '');
assert.match(visualUnderstandingTokenStop(usageBuckets, 'openai', 'vision-a', 210), /达到单模型停止线 210/);
assert.equal(visualUnderstandingTokenStop(usageBuckets, 'openai', 'vision-other', 1), '');
const requestRecord: VisualUnderstandingRequestRecord = { requestId: 'visual-request-test', requestedAt: '2026-10-04T00:00:00.000Z', completedAt: '2026-10-04T00:00:01.000Z', providerId: 'openai', provider: 'OpenAI', model: 'vision-a', pass: 'initial', sessionRequestNumber: 1, payload, frames: fingerprints, duplicateFrameReview: { confirmed: true, confirmedAt: '2026-10-03T23:59:59.000Z', groups: [{ sha256: fingerprints[0].sha256, frameIds: ['frame-1', 'frame-2'] }] }, status: 'succeeded', tokenUsage: { inputTokens: 140, outputTokens: 30, totalTokens: 170 } };
const requestLog = await createVisualUnderstandingRequestLog([requestRecord], '2026-10-04T00:00:02.000Z');
assert.equal(requestLog.format, 'hyperframes-visual-request-log-v1');
assert.match(requestLog.recordsSha256, /^[a-f0-9]{64}$/);
assert.deepEqual(requestLog.records, [requestRecord]);
requestRecord.model = 'mutated-after-export';
assert.equal(requestLog.records[0].model, 'vision-a', '导出必须冻结记录快照');
assert.deepEqual(await verifyVisualUnderstandingRequestLog(requestLog), { valid: true, recordCount: 1, failedCount: 0, reportedTokenRequests: 1, recordsSha256: requestLog.recordsSha256 });
const legacyLogWithoutDuplicateReview = await createVisualUnderstandingRequestLog([{ ...requestLog.records[0], duplicateFrameReview: undefined }].map((record) => { const { duplicateFrameReview: _ignored, ...legacy } = record; return legacy; }));
assert.equal((await verifyVisualUnderstandingRequestLog(legacyLogWithoutDuplicateReview)).valid, true, '旧 v1 记录没有重复截图确认凭证时继续兼容');
const inconsistentDuplicateReview = await createVisualUnderstandingRequestLog([{ ...requestLog.records[0], duplicateFrameReview: { confirmed: true, confirmedAt: '2026-10-03T23:59:59.000Z', groups: [{ sha256: fingerprints[0].sha256, frameIds: ['frame-2', 'frame-1'] }] } }]);
await assert.rejects(() => verifyVisualUnderstandingRequestLog(inconsistentDuplicateReview), /重复截图确认与帧指纹不一致/);
const similarFrames = [
  { ...fingerprints[0], perceptualHash: '0000000000000000' },
  { ...fingerprints[1], sha256: 'f'.repeat(64), perceptualHash: '0000000000000001' },
];
const similarReviewLog = await createVisualUnderstandingRequestLog([{ ...requestLog.records[0], frames: similarFrames, duplicateFrameReview: undefined, similarFrameReview: { confirmed: true, confirmedAt: '2026-10-03T23:59:59.000Z', maxHammingDistance: 4, pairs: [{ firstFrameId: 'frame-1', secondFrameId: 'frame-2', hammingDistance: 1 }] } }].map((record) => { const { duplicateFrameReview: _ignored, ...withSimilarity } = record; return withSimilarity; }));
assert.equal((await verifyVisualUnderstandingRequestLog(similarReviewLog)).valid, true);
const inconsistentSimilarReview = await createVisualUnderstandingRequestLog([{ ...similarReviewLog.records[0], similarFrameReview: { ...similarReviewLog.records[0].similarFrameReview!, pairs: [{ firstFrameId: 'frame-1', secondFrameId: 'frame-2', hammingDistance: 2 }] } }]);
await assert.rejects(() => verifyVisualUnderstandingRequestLog(inconsistentSimilarReview), /相似截图确认与感知哈希不一致/);
await assert.rejects(() => verifyVisualUnderstandingRequestLog({ ...requestLog, records: [{ ...requestLog.records[0], model: 'tampered' }] }), /哈希不匹配/);
await assert.rejects(() => verifyVisualUnderstandingRequestLog({ ...requestLog, unexpected: true }), /未知字段/);
await assert.rejects(() => verifyVisualUnderstandingRequestLog({ ...requestLog, records: [{ ...requestLog.records[0], tokenUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 9 } }] }), /Token 字段/);
await assert.rejects(() => createVisualUnderstandingRequestLog([], 'not-a-date'), /导出时间/);
const serialized = JSON.stringify(requestBody);
assert.match(serialized, /input_image/);
assert.match(serialized, /detail":"low/);
assert.match(serialized, /把杯子放到桌上/);
assert.doesNotMatch(serialized, /video\/mp4/);

process.env.HYPERFRAMES_LOCAL_VISION_MODEL = 'qwen3-vl:8b';
process.env.HYPERFRAMES_LOCAL_VISION_BASE_URL = 'http://127.0.0.1:11434/v1';
delete process.env.HYPERFRAMES_LOCAL_VISION_API_KEY;
const capabilities = getSourceVisualUnderstandingCapabilities();
const local = capabilities.providers.find((provider) => provider.id === 'local-openai');
assert.equal(local?.available, true);
assert.equal(local?.local, true);
assert.equal(capabilities.defaultProviderId, 'local-openai');
let localURL = '';
let localHeaders: HeadersInit | undefined;
let localBody: Record<string, unknown> | undefined;
const localFetcher = async (url: string | URL | Request, init?: RequestInit) => {
  localURL = String(url); localHeaders = init?.headers; localBody = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ usage: { prompt_tokens: 120, completion_tokens: 25, total_tokens: 145 }, choices: [{ message: { content: JSON.stringify({ candidates: [candidate], sequences: [sequence] }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const localResult = await analyzeSourceVisualFrames(frames, 'local-openai', localFetcher as typeof fetch);
assert.equal(localResult.providerId, 'local-openai');
assert.equal(localResult.model, 'qwen3-vl:8b');
assert.equal(localResult.sequences?.[0].frameIds.length, 2);
assert.deepEqual(localResult.tokenUsage, { inputTokens: 120, outputTokens: 25, totalTokens: 145 });
assert.equal(localURL, 'http://127.0.0.1:11434/v1/chat/completions');
assert.doesNotMatch(JSON.stringify(localHeaders), /Authorization/i, '无本机密钥时不得伪造或外泄认证头');
assert.match(JSON.stringify(localBody), /image_url/);
assert.match(JSON.stringify(localBody), /json_schema/);

const probe = await probeSourceVisualUnderstandingProvider('local-openai', (async (url: string | URL | Request) => {
  assert.equal(String(url), 'http://127.0.0.1:11434/v1/models');
  return new Response(JSON.stringify({ data: [{ id: 'qwen3-vl:8b' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch);
assert.equal(probe.ok, true);
assert.equal(probe.modelFound, true);

process.env.HYPERFRAMES_LOCAL_VISION_BASE_URL = 'http://example.com/v1';
const invalidLocal = getSourceVisualUnderstandingCapabilities().providers.find((provider) => provider.id === 'local-openai');
assert.equal(invalidLocal?.available, false);
assert.match(invalidLocal?.configurationError ?? '', /localhost/);
console.log('Source visual understanding checks passed.');
