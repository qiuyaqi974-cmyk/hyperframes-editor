import assert from 'node:assert/strict';
import { createReleaseCandidate } from '../src/lib/releaseCandidate';
import { analyzePostPublishMetrics, createPostPublishObservation, decidePostPublishInsight, observationMatchesCandidate } from '../src/lib/postPublishFeedback';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';

const plan: ScenePlan = { projectName: '发布反馈测试', scenes: [{ id: 's1', duration: 20, blocks: [{ type: 'text', content: '测试', duration: 20 }] }] };
const snapshot = scenePlanToSnapshot(plan);
snapshot.director = { objective: '解释', audience: '创作者', thesis: '一条论点', contentType: 'knowledge', tone: '克制', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '', scenes: {}, updatedAt: 'before' };
const rc = createReleaseCandidate(snapshot, [], new Date('2026-09-18T00:00:00.000Z'));
const input = {
  rcId: rc.id,
  source: { kind: 'manual-entry' as const, platform: 'B站', accountLabel: '账号 A', postUrl: 'BV-test' },
  publishedAt: '2026-09-18T08:00:00.000Z', observedAt: '2026-09-19T08:00:00.000Z',
  metrics: { views: 1000, averageWatchSeconds: 7, completionRate: 30, retention: [{ second: 0, rate: 100 }, { second: 3, rate: 60 }], comments: { total: 20, questions: 6, objections: 4, positive: 8, summary: '大家希望看到具体例子' } },
};

assert.throws(() => createPostPublishObservation(input, [rc], new Date('2026-09-20T00:00:00.000Z')), /成片哈希/);
rc.render = { outputPath: 'D:/final.mp4', reportPath: 'D:/report.json', sha256: 'sha-final', renderedAt: '2026-09-18T01:00:00.000Z' };
const frozenRC = JSON.stringify(rc);
const observation = createPostPublishObservation(input, [rc], new Date('2026-09-20T00:00:00.000Z'));
assert.equal(observation.windowHours, 24);
assert.equal(observation.rcId, rc.id);
assert.equal(observation.renderSha256, 'sha-final');
assert(observation.insights.every((item) => item.decision === 'pending'));
assert(observation.insights.some((item) => item.id === 'early-retention'));
assert(observation.insights.some((item) => item.id === 'completion'));
assert(observation.insights.some((item) => item.id === 'questions'));
assert(observation.insights.some((item) => item.id === 'objections'));
assert(observationMatchesCandidate(observation, rc));
assert(!observationMatchesCandidate(observation, { ...rc, render: { ...rc.render, sha256: 'other' } }));

assert.throws(() => createPostPublishObservation({ ...input, rcId: 'missing' }, [rc]), /找不到/);
assert.throws(() => createPostPublishObservation({ ...input, source: { ...input.source, postUrl: '' } }, [rc]), /发布链接/);
assert.throws(() => createPostPublishObservation({ ...input, observedAt: input.publishedAt }, [rc]), /晚于/);
assert.throws(() => createPostPublishObservation({ ...input, observedAt: '2027-01-01T00:00:00.000Z' }, [rc], new Date('2026-09-20T00:00:00.000Z')), /未来/);
assert.throws(() => createPostPublishObservation({ ...input, metrics: { ...input.metrics, completionRate: 101 } }, [rc]), /完播率/);
assert.throws(() => createPostPublishObservation({ ...input, metrics: { ...input.metrics, comments: { total: 2, questions: 3 } } }, [rc]), /超过/);
assert.throws(() => createPostPublishObservation(input, [rc], new Date('2026-09-20T00:00:00.000Z'), [observation]), /已经存在/);
assert.throws(() => createPostPublishObservation({ ...input, metrics: { retention: [] } }, [rc]), /至少填写/);

const rawBefore = JSON.stringify({ ...observation, insights: undefined });
assert.throws(() => decidePostPublishInsight(observation, 'completion', 'accepted', '节奏值得调整', false), /确认/);
assert.throws(() => decidePostPublishInsight(observation, 'completion', 'accepted', '', true), /理由/);
const accepted = decidePostPublishInsight(observation, 'completion', 'accepted', '同账号同时间窗对照也偏低，下一轮前移论点。', true, new Date('2026-09-20T01:00:00.000Z'));
assert.equal(accepted.insights.find((item) => item.id === 'completion')?.decision, 'accepted');
assert.equal(observation.insights.find((item) => item.id === 'completion')?.decision, 'pending', 'decision is immutable update');
assert.equal(JSON.stringify({ ...accepted, insights: undefined }), rawBefore, 'decision does not rewrite raw observation');
assert.equal(JSON.stringify(rc), frozenRC, 'feedback never rewrites frozen RC');
assert.equal(snapshot.director.updatedAt, 'before', 'feedback never rewrites current director');

const positive = analyzePostPublishMetrics({ completionRate: 70, retention: [{ second: 3, rate: 85 }] }, 20);
assert.match(positive.find((item) => item.id === 'early-retention')!.statement, /对照基线/);
console.log('Post-publish feedback checks passed: RC/hash attribution, source/window validation, metric analysis, duplicate guard and explicit immutable director adoption.');
