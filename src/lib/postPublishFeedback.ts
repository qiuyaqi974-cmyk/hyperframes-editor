import type { ReleaseCandidate } from '@/lib/releaseCandidate';

export interface RetentionPoint {
  second: number;
  rate: number;
}

export interface PostPublishMetrics {
  views?: number;
  averageWatchSeconds?: number;
  completionRate?: number;
  retention: RetentionPoint[];
  comments?: {
    total?: number;
    questions?: number;
    objections?: number;
    positive?: number;
    summary?: string;
  };
}

export type DirectorFeedbackDecision = 'pending' | 'accepted' | 'rejected';

export interface DirectorFeedbackInsight {
  id: string;
  category: 'hook' | 'pacing' | 'thesis' | 'cta' | 'audience';
  statement: string;
  evidence: string;
  decision: DirectorFeedbackDecision;
  decisionReason?: string;
  decidedAt?: string;
}

export interface PostPublishObservation {
  id: string;
  rcId: string;
  rcLabel: string;
  renderSha256: string;
  storyVersionId?: string;
  source: {
    kind: 'manual-entry' | 'platform-export';
    platform: string;
    accountLabel: string;
    postUrl: string;
    sourceFileName?: string;
    sourceFileSha256?: string;
    mappingReceipt?: {
      rowIndex: number;
      fields: Array<{ sourceField: string; targetField: string; unit: string }>;
      ignoredFields: string[];
      confirmedAt: string;
    };
    recordedAt: string;
  };
  publishedAt: string;
  observedAt: string;
  windowHours: number;
  metrics: PostPublishMetrics;
  insights: DirectorFeedbackInsight[];
  createdAt: string;
}

export interface PostPublishObservationInput {
  rcId: string;
  source: Omit<PostPublishObservation['source'], 'recordedAt'>;
  publishedAt: string;
  observedAt: string;
  metrics: PostPublishMetrics;
}

function finite(value: unknown, label: string, options: { min?: number; max?: number } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}必须是有效数字。`);
  if (options.min !== undefined && number < options.min) throw new Error(`${label}不能小于 ${options.min}。`);
  if (options.max !== undefined && number > options.max) throw new Error(`${label}不能大于 ${options.max}。`);
  return number;
}

function normalizeMetrics(metrics: PostPublishMetrics): PostPublishMetrics {
  const retention = (metrics.retention ?? []).map((point) => ({
    second: finite(point.second, '留存时间', { min: 0 })!,
    rate: finite(point.rate, '留存率', { min: 0, max: 100 })!,
  })).sort((a, b) => a.second - b.second);
  for (let index = 1; index < retention.length; index += 1) {
    if (retention[index].second === retention[index - 1].second) throw new Error('留存曲线不能包含重复时间点。');
  }
  const comments = metrics.comments ? {
    total: finite(metrics.comments.total, '评论总数', { min: 0 }),
    questions: finite(metrics.comments.questions, '提问评论数', { min: 0 }),
    objections: finite(metrics.comments.objections, '质疑评论数', { min: 0 }),
    positive: finite(metrics.comments.positive, '正向评论数', { min: 0 }),
    summary: metrics.comments.summary?.trim() || undefined,
  } : undefined;
  if (comments?.total !== undefined) {
    for (const [label, value] of [['提问评论数', comments.questions], ['质疑评论数', comments.objections], ['正向评论数', comments.positive]] as const) {
      if (value !== undefined && value > comments.total) throw new Error(`${label}不能超过评论总数。`);
    }
  }
  return {
    views: finite(metrics.views, '播放量', { min: 0 }),
    averageWatchSeconds: finite(metrics.averageWatchSeconds, '平均观看秒数', { min: 0 }),
    completionRate: finite(metrics.completionRate, '完播率', { min: 0, max: 100 }),
    retention,
    ...(comments ? { comments } : {}),
  };
}

function insight(id: string, category: DirectorFeedbackInsight['category'], statement: string, evidence: string): DirectorFeedbackInsight {
  return { id, category, statement, evidence, decision: 'pending' };
}

export function analyzePostPublishMetrics(metrics: PostPublishMetrics, duration: number): DirectorFeedbackInsight[] {
  const result: DirectorFeedbackInsight[] = [];
  const early = metrics.retention.find((point) => point.second > 0 && point.second <= Math.min(5, duration));
  if (early) {
    result.push(early.rate < 70
      ? insight('early-retention', 'hook', '下轮需要重新审视开场承诺与首个画面。', `${early.second}s 留存 ${early.rate.toFixed(1)}%，这里只说明早段流失，不自动归因。`)
      : insight('early-retention', 'hook', '当前开场可作为下轮对照基线。', `${early.second}s 留存 ${early.rate.toFixed(1)}%，仍需与同账号同时间窗内容比较。`));
  }
  if (metrics.completionRate !== undefined) {
    result.push(metrics.completionRate < 35
      ? insight('completion', 'pacing', '下轮应检查中后段节奏、重复和信息兑现。', `完播率 ${metrics.completionRate.toFixed(1)}%。`)
      : insight('completion', 'pacing', '保留当前结构作为节奏对照，继续观察不同选题。', `完播率 ${metrics.completionRate.toFixed(1)}%。`));
  }
  if (metrics.averageWatchSeconds !== undefined && duration > 0) {
    const ratio = Math.min(999, metrics.averageWatchSeconds / duration * 100);
    result.push(insight('average-watch', 'pacing', ratio < 45 ? '平均观看位置偏前，检查核心论点是否出现过晚。' : '平均观看覆盖主要结构，可作为论点出现时机的证据。', `平均观看 ${metrics.averageWatchSeconds.toFixed(1)}s / 成片 ${duration.toFixed(1)}s（${ratio.toFixed(1)}%）。`));
  }
  const comments = metrics.comments;
  if (comments?.total) {
    if ((comments.questions ?? 0) / comments.total >= 0.2) result.push(insight('questions', 'audience', '评论中的提问较集中，下轮应明确受众前置知识与解释边界。', `提问 ${comments.questions} / 评论 ${comments.total}。`));
    if ((comments.objections ?? 0) / comments.total >= 0.15) result.push(insight('objections', 'thesis', '质疑占比较高，下轮应补强论点限定或证据。', `质疑 ${comments.objections} / 评论 ${comments.total}。`));
    if (comments.summary) result.push(insight('comment-summary', 'cta', '将人工评论摘要作为结尾行动与选题延伸的参考。', comments.summary));
  }
  return result;
}

function projectDuration(candidate: ReleaseCandidate) {
  const snapshot = candidate.snapshot;
  return Math.max(snapshot.narration?.duration ?? 0, ...snapshot.blocks.map((block) => block.start + block.duration), ...snapshot.scenes.map((scene) => scene.end), 0);
}

export function createPostPublishObservation(input: PostPublishObservationInput, candidates: ReleaseCandidate[], now = new Date(), existing: PostPublishObservation[] = []): PostPublishObservation {
  const candidate = candidates.find((item) => item.id === input.rcId);
  if (!candidate) throw new Error('找不到对应的冻结 RC，不能猜测版本归属。');
  if (!candidate.render?.sha256) throw new Error('该 RC 没有最终成片哈希，不能建立发布数据归属。');
  const platform = input.source.platform.trim();
  const accountLabel = input.source.accountLabel.trim();
  const postUrl = input.source.postUrl.trim();
  if (!platform || !accountLabel || !postUrl) throw new Error('请填写平台、账号/数据源标识和发布链接/内容 ID。');
  if (!['manual-entry', 'platform-export'].includes(input.source.kind)) throw new Error('未知的数据来源类型。');
  const publishedMs = Date.parse(input.publishedAt);
  const observedMs = Date.parse(input.observedAt);
  if (!Number.isFinite(publishedMs) || !Number.isFinite(observedMs)) throw new Error('发布时间和观测时间必须有效。');
  if (observedMs <= publishedMs) throw new Error('观测时间必须晚于发布时间。');
  if (observedMs > now.getTime() + 5 * 60_000) throw new Error('观测时间不能在未来。');
  const metrics = normalizeMetrics(input.metrics);
  if (metrics.views === undefined && metrics.averageWatchSeconds === undefined && metrics.completionRate === undefined && !metrics.retention.length && !metrics.comments?.total && !metrics.comments?.summary) {
    throw new Error('至少填写一项发布后指标或评论摘要。');
  }
  const createdAt = now.toISOString();
  if (existing.some((item) => item.rcId === candidate.id && item.source.platform === platform && item.source.postUrl === postUrl && item.observedAt === new Date(observedMs).toISOString())) {
    throw new Error('同一 RC、发布内容和观测时间的数据已经存在。');
  }
  return {
    id: `post-${now.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    rcId: candidate.id,
    rcLabel: candidate.label,
    renderSha256: candidate.render.sha256,
    storyVersionId: candidate.storyDecision?.versionId,
    source: { ...input.source, platform, accountLabel, postUrl, sourceFileName: input.source.sourceFileName?.trim() || undefined, recordedAt: createdAt },
    publishedAt: new Date(publishedMs).toISOString(),
    observedAt: new Date(observedMs).toISOString(),
    windowHours: Number(((observedMs - publishedMs) / 3_600_000).toFixed(2)),
    metrics,
    insights: analyzePostPublishMetrics(metrics, projectDuration(candidate)),
    createdAt,
  };
}

export function decidePostPublishInsight(observation: PostPublishObservation, insightId: string, decision: Exclude<DirectorFeedbackDecision, 'pending'>, reason: string, confirmed: boolean, now = new Date()) {
  const text = reason.trim();
  if (!confirmed) throw new Error('请先确认你已检查版本归属、时间窗和证据。');
  if (!text) throw new Error('采纳或拒绝都必须记录理由。');
  if (!observation.insights.some((item) => item.id === insightId)) throw new Error('找不到这条发布后洞察。');
  return { ...observation, insights: observation.insights.map((item) => item.id === insightId ? { ...item, decision, decisionReason: text, decidedAt: now.toISOString() } : item) };
}

export function observationMatchesCandidate(observation: PostPublishObservation, candidate: ReleaseCandidate | undefined) {
  return Boolean(candidate && candidate.id === observation.rcId && candidate.render?.sha256 === observation.renderSha256);
}
