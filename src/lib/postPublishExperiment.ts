import type { PostPublishObservation } from '@/lib/postPublishFeedback';
import type { ReleaseCandidate } from '@/lib/releaseCandidate';

export interface PostPublishMetricDelta {
  key: string;
  label: string;
  left: number;
  right: number;
  delta: number;
  unit: '' | '%' | 's';
}

export interface PostPublishExperimentComparison {
  leftObservationId: string;
  rightObservationId: string;
  status: 'blocked' | 'limited' | 'comparable';
  blockers: string[];
  warnings: string[];
  facts: {
    left: ExperimentSideFacts;
    right: ExperimentSideFacts;
    windowDifferenceHours: number;
    viewRatio?: number;
  };
  metrics: PostPublishMetricDelta[];
  generatedAt: string;
}

export interface ExperimentSideFacts {
  observationId: string;
  rcId: string;
  rcLabel: string;
  renderSha256: string;
  storyVersionId?: string;
  projectName: string;
  topic: string;
  contentType: string;
  platform: string;
  accountLabel: string;
  postUrl: string;
  publishedAt: string;
  observedAt: string;
  windowHours: number;
  duration: number;
  views?: number;
}

export interface PostPublishExperimentReview {
  id: string;
  leftObservationId: string;
  rightObservationId: string;
  leftRcId: string;
  rightRcId: string;
  leftRenderSha256: string;
  rightRenderSha256: string;
  comparison: PostPublishExperimentComparison;
  conclusion: string;
  confirmedAt: string;
  nonCausalAcknowledged: true;
}

function normalized(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function durationOf(candidate: ReleaseCandidate) {
  return Math.max(candidate.snapshot.narration?.duration ?? 0, ...candidate.snapshot.blocks.map((block) => block.start + block.duration), ...candidate.snapshot.scenes.map((scene) => scene.end), 0);
}

function topicOf(candidate: ReleaseCandidate) {
  const director = candidate.snapshot.director;
  return [director?.objective, director?.thesis].map((item) => item?.trim()).filter(Boolean).join(' · ') || candidate.projectName;
}

function topicFingerprint(candidate: ReleaseCandidate) {
  const director = candidate.snapshot.director;
  return JSON.stringify([director?.contentType ?? '', normalized(director?.audience ?? ''), normalized(director?.objective ?? ''), normalized(director?.thesis ?? '')]);
}

function side(observation: PostPublishObservation, candidate: ReleaseCandidate): ExperimentSideFacts {
  return {
    observationId: observation.id, rcId: observation.rcId, rcLabel: observation.rcLabel, renderSha256: observation.renderSha256,
    storyVersionId: observation.storyVersionId, projectName: candidate.projectName, topic: topicOf(candidate), contentType: candidate.snapshot.director?.contentType ?? 'unknown',
    platform: observation.source.platform, accountLabel: observation.source.accountLabel, postUrl: observation.source.postUrl,
    publishedAt: observation.publishedAt, observedAt: observation.observedAt, windowHours: observation.windowHours,
    duration: durationOf(candidate), views: observation.metrics.views,
  };
}

function addMetric(rows: PostPublishMetricDelta[], key: string, label: string, left: number | undefined, right: number | undefined, unit: PostPublishMetricDelta['unit']) {
  if (left === undefined || right === undefined) return;
  rows.push({ key, label, left, right, delta: Number((right - left).toFixed(3)), unit });
}

export function comparePostPublishObservations(left: PostPublishObservation, right: PostPublishObservation, candidates: ReleaseCandidate[], now = new Date()): PostPublishExperimentComparison {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const leftCandidate = candidates.find((item) => item.id === left.rcId);
  const rightCandidate = candidates.find((item) => item.id === right.rcId);
  if (left.id === right.id) blockers.push('请选择两条不同的发布观察。');
  if (left.rcId === right.rcId) blockers.push('两条观察来自同一个 RC，不能作为版本对照。');
  if (!leftCandidate || leftCandidate.render?.sha256 !== left.renderSha256) blockers.push(`左侧 ${left.rcLabel} 的冻结 RC 或成片哈希无法验证。`);
  if (!rightCandidate || rightCandidate.render?.sha256 !== right.renderSha256) blockers.push(`右侧 ${right.rcLabel} 的冻结 RC 或成片哈希无法验证。`);

  const safeLeft = leftCandidate ?? ({ projectName: left.rcLabel, snapshot: { director: undefined, blocks: [], scenes: [] }, render: undefined } as unknown as ReleaseCandidate);
  const safeRight = rightCandidate ?? ({ projectName: right.rcLabel, snapshot: { director: undefined, blocks: [], scenes: [] }, render: undefined } as unknown as ReleaseCandidate);
  const leftFacts = side(left, safeLeft);
  const rightFacts = side(right, safeRight);
  if (normalized(left.source.platform) !== normalized(right.source.platform)) blockers.push('平台不同，分发机制不可直接比较。');
  if (normalized(left.source.accountLabel) !== normalized(right.source.accountLabel)) blockers.push('账号或数据源不同，受众基线不可直接比较。');
  if (normalized(left.source.postUrl) === normalized(right.source.postUrl)) blockers.push('两条观察指向同一个发布内容，不能代表两个版本的独立发布。');
  const windowDifferenceHours = Number(Math.abs(left.windowHours - right.windowHours).toFixed(2));
  const allowedWindowGap = Math.max(6, Math.min(left.windowHours, right.windowHours) * 0.2);
  if (windowDifferenceHours > allowedWindowGap) blockers.push(`观测窗口相差 ${windowDifferenceHours} 小时，超过允许的 ${allowedWindowGap.toFixed(1)} 小时。`);
  else if (windowDifferenceHours > 0.25) warnings.push(`观测窗口并不完全一致：${left.windowHours}h vs ${right.windowHours}h。`);
  if (leftCandidate && rightCandidate) {
    if (topicFingerprint(leftCandidate) !== topicFingerprint(rightCandidate)) blockers.push('导演目标、受众、内容类型或核心表达不同，不能把差异归于版本。');
    if (left.renderSha256 === right.renderSha256) blockers.push('两侧成片哈希相同，没有形成可比较的版本变化。');
    const durationGap = Math.abs(leftFacts.duration - rightFacts.duration);
    const durationBase = Math.max(1, Math.min(leftFacts.duration, rightFacts.duration));
    if (durationGap / durationBase > 0.1) warnings.push(`成片时长相差 ${durationGap.toFixed(1)} 秒，平均观看秒数和完播率的含义可能不同。`);
  }
  if (left.publishedAt !== right.publishedAt) warnings.push(`发布时间不同：${new Date(left.publishedAt).toLocaleString()} vs ${new Date(right.publishedAt).toLocaleString()}，流量环境可能不同。`);
  const views = left.metrics.views !== undefined && right.metrics.views !== undefined ? [left.metrics.views, right.metrics.views] : undefined;
  const viewRatio = views ? Number((Math.max(...views) / Math.max(1, Math.min(...views))).toFixed(2)) : undefined;
  if (viewRatio && viewRatio >= 2) warnings.push(`播放样本量相差 ${viewRatio} 倍，百分比指标的稳定性可能不同。`);

  const metrics: PostPublishMetricDelta[] = [];
  addMetric(metrics, 'views', '播放量', left.metrics.views, right.metrics.views, '');
  addMetric(metrics, 'average-watch', '平均观看', left.metrics.averageWatchSeconds, right.metrics.averageWatchSeconds, 's');
  addMetric(metrics, 'completion', '完播率', left.metrics.completionRate, right.metrics.completionRate, '%');
  addMetric(metrics, 'comments', '评论总数', left.metrics.comments?.total, right.metrics.comments?.total, '');
  addMetric(metrics, 'questions', '提问评论', left.metrics.comments?.questions, right.metrics.comments?.questions, '');
  addMetric(metrics, 'objections', '质疑评论', left.metrics.comments?.objections, right.metrics.comments?.objections, '');
  addMetric(metrics, 'positive', '正向评论', left.metrics.comments?.positive, right.metrics.comments?.positive, '');
  for (const point of left.metrics.retention) {
    const match = right.metrics.retention.find((candidate) => Math.abs(candidate.second - point.second) <= 0.5);
    if (match) addMetric(metrics, `retention-${point.second}`, `${point.second}s 留存`, point.rate, match.rate, '%');
  }
  if (!metrics.length) blockers.push('两侧没有名称和单位一致的指标，无法比较。');
  return {
    leftObservationId: left.id, rightObservationId: right.id,
    status: blockers.length ? 'blocked' : warnings.length ? 'limited' : 'comparable', blockers, warnings,
    facts: { left: leftFacts, right: rightFacts, windowDifferenceHours, viewRatio }, metrics, generatedAt: now.toISOString(),
  };
}

export function createPostPublishExperimentReview(comparison: PostPublishExperimentComparison, conclusion: string, acknowledged: boolean, existing: PostPublishExperimentReview[] = [], now = new Date()): PostPublishExperimentReview {
  if (comparison.blockers.length) throw new Error('当前对照存在阻断项，不能保存版本效果结论。');
  if (!acknowledged) throw new Error('请确认你理解这只是描述性对照，不是因果证明。');
  const text = conclusion.trim();
  if (!text) throw new Error('请写明人工比较结论和限制。');
  const pairKey = [comparison.leftObservationId, comparison.rightObservationId].sort().join(':');
  if (existing.some((item) => [item.leftObservationId, item.rightObservationId].sort().join(':') === pairKey)) throw new Error('这组观察已经保存过人工结论。');
  return {
    id: `experiment-${now.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    leftObservationId: comparison.leftObservationId, rightObservationId: comparison.rightObservationId,
    leftRcId: comparison.facts.left.rcId, rightRcId: comparison.facts.right.rcId,
    leftRenderSha256: comparison.facts.left.renderSha256, rightRenderSha256: comparison.facts.right.renderSha256,
    comparison: structuredClone(comparison), conclusion: text, confirmedAt: now.toISOString(), nonCausalAcknowledged: true,
  };
}

export function experimentReviewIsCurrent(review: PostPublishExperimentReview, observations: PostPublishObservation[], candidates: ReleaseCandidate[]) {
  const left = observations.find((item) => item.id === review.leftObservationId);
  const right = observations.find((item) => item.id === review.rightObservationId);
  return Boolean(left && right && left.renderSha256 === review.leftRenderSha256 && right.renderSha256 === review.rightRenderSha256
    && candidates.find((item) => item.id === review.leftRcId)?.render?.sha256 === review.leftRenderSha256
    && candidates.find((item) => item.id === review.rightRcId)?.render?.sha256 === review.rightRenderSha256);
}
