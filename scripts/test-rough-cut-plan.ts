import assert from 'node:assert/strict';
import { acceptedRoughCutCandidates, adjustRoughCutPadding, applyRoughCutRoleTemplate, applyRoughCutSuggestion, confirmRoughCutStructure, createSourceRoughCutPlan, moveRoughCutCandidate, roughCutPlanReadiness, updateRoughCutDecision } from '../src/lib/roughCutPlan';
import type { DirectorDecision, SourceTranscriptSegment } from '../src/types';
import { visualCheckpointTimes, waveformWindowPeaks } from '../src/lib/sourceVisualCheckpoint';

const director: DirectorDecision = {
  objective: '保留做饭关键讲解', audience: '新手', thesis: '按步骤讲清楚', contentType: 'tutorial',
  tone: '自然', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '', scenes: {}, updatedAt: '',
};
const transcript: SourceTranscriptSegment[] = [{
  id: 'words', start: 1, end: 4, text: '先热锅 然后放盐',
  words: [
    { start: 1, end: 1.4, word: '先热锅' },
    { start: 1.6, end: 2, word: '，然后' },
    { start: 2.7, end: 3.2, word: '放盐' },
  ],
}];
const plan = createSourceRoughCutPlan('cooking', 30, transcript, director, { now: new Date('2026-09-19T00:00:00.000Z') });
assert.equal(plan.candidates.length, 2, '0.7 秒停顿应拆成两个候选');
assert.equal(plan.candidates[0].start, 0.95);
assert.equal(plan.candidates[0].end, 2.08);
assert.equal(plan.candidates[0].boundary, 'word');
assert.equal(plan.candidates[0].decision, 'review');
assert.match(plan.candidates[0].reason, /画面需人工确认/);

const accepted = updateRoughCutDecision(plan, plan.candidates[1].id, 'keep');
assert.deepEqual(acceptedRoughCutCandidates(accepted).map((candidate) => candidate.text), ['放盐']);
assert.equal(roughCutPlanReadiness(accepted).ready, false, '保留片段未做视觉检查时不得执行粗剪');
const visuallyApproved = { ...accepted, candidates: accepted.candidates.map((candidate) => candidate.decision === 'keep' ? { ...candidate, visualReview: { status: 'approved' as const, checkedAt: '', windowStart: candidate.start, windowEnd: candidate.end } } : candidate) };
assert.equal(roughCutPlanReadiness(visuallyApproved).ready, false, '画面通过但导演结构未确认时仍不得执行');
const structured = applyRoughCutRoleTemplate(visuallyApproved, director.contentType);
assert.equal(structured.candidates.find((candidate) => candidate.decision === 'keep')?.narrativeRole, 'hook');
const confirmed = confirmRoughCutStructure(structured, new Date('2026-09-19T00:01:00.000Z'));
assert.equal(roughCutPlanReadiness(confirmed).ready, true);
assert.equal(roughCutPlanReadiness(confirmed, 'later-director-update').directorStale, true, '导演 Brief 更新后旧结构确认必须失效');
assert.equal(roughCutPlanReadiness(confirmed, 'later-director-update').ready, false);
const moreTail = adjustRoughCutPadding(confirmed, plan.candidates[1].id, 'end', 0.05, transcript, 30);
assert.equal(moreTail.candidates[1].end, 3.33);
assert.equal(moreTail.candidates[1].visualReview, undefined, '边界调整后必须重新视觉检查');

const imported = createSourceRoughCutPlan('srt', 10, [{ id: 'srt', start: 2, end: 4, text: '外部字幕' }], director);
assert.equal(imported.candidates[0].boundary, 'segment');
assert.equal(imported.candidates[0].start, 1.8);
assert.equal(imported.candidates[0].end, 4.2);

const withEvents = createSourceRoughCutPlan('events', 30, transcript, director, { markers: [
  { id: 'highlight', label: '下锅特写', start: 1.2, end: 1.8, kind: 'highlight', createdAt: '2026-09-19T00:00:00.000Z', visualConfirmed: true },
  { id: 'exclude', label: '手挡镜头', start: 2.8, end: 3.1, kind: 'exclude', createdAt: '2026-09-19T00:00:01.000Z', visualConfirmed: true },
] });
const highlight = withEvents.candidates.find((candidate) => candidate.markerId === 'highlight');
assert.equal(highlight?.start, 0.95, '人工边界切进词内时应向外吸附完整词');
assert.equal(highlight?.end, 2.08);
assert.equal(highlight?.decision, 'keep');
assert.equal(highlight?.visualReview?.status, 'approved');
assert.equal(withEvents.candidates.find((candidate) => candidate.text === '放盐' && candidate.origin === 'speech')?.decision, 'drop', '人工排除区间应压掉重叠语音候选');
const firstSpeech = withEvents.candidates.find((candidate) => candidate.origin === 'speech' && candidate.text.includes('先热锅'));
const conflicting = firstSpeech ? updateRoughCutDecision(withEvents, firstSpeech.id, 'keep') : withEvents;
assert.equal(roughCutPlanReadiness(conflicting).overlapPairs.length, 1, '两个保留片段重叠时必须阻止执行');

const signature = 'source-signature';
const withSemantics = createSourceRoughCutPlan('semantic-events', 30, transcript, director, { markerSourceSignature: signature, markers: [{
  id: 'confirmed-action', label: '盐落入锅中', start: 2.7, end: 3.2, kind: 'action', createdAt: '2026-09-19T00:00:00.000Z', visualConfirmed: true,
  semantics: { subject: '厨师', action: '放入', object: '盐', result: '盐已入锅', shot: 'detail', tags: ['步骤'], method: 'human-observed', reviewedAt: '2026-09-19T00:00:00.000Z', sourceSignature: signature, start: 2.7, end: 3.2 },
}] });
const jointSuggestion = withSemantics.candidates.find((candidate) => candidate.markerId === 'confirmed-action');
assert.equal(jointSuggestion?.decision, 'review', '联合建议不得自动改变粗剪决定');
assert.equal(jointSuggestion?.suggestion?.decision, 'keep');
assert.equal(jointSuggestion?.suggestion?.transcriptEvidence, true);
assert.deepEqual(jointSuggestion?.suggestion?.confirmedVisualMarkerIds, ['confirmed-action']);
assert.ok(jointSuggestion?.suggestion?.narrativeRole, '保留建议必须提供待审叙事职责');
assert.equal(withSemantics.candidates.find((candidate) => candidate.origin === 'speech' && candidate.text.includes('放盐'))?.suggestion, undefined, '不得同时建议保留相互重叠的动作与语音候选');
const suggested = jointSuggestion ? applyRoughCutSuggestion(withSemantics, jointSuggestion.id) : withSemantics;
assert.equal(suggested.candidates.find((candidate) => candidate.id === jointSuggestion?.id)?.decision, 'keep');
assert.equal(roughCutPlanReadiness(suggested).ready, false, '采纳联合建议不得绕过视觉与结构门禁');

const exclusionSuggestion = createSourceRoughCutPlan('semantic-exclusion', 30, transcript, director, { markerSourceSignature: signature, markers: [{
  id: 'confirmed-obstruction', label: '手部经过镜头', start: 1.2, end: 1.8, kind: 'action', createdAt: '', visualConfirmed: true,
  semantics: { subject: '手', action: '经过', object: '镜头', result: '主体被遮挡', shot: 'closeup', tags: ['遮挡'], method: 'human-observed', reviewedAt: '', sourceSignature: signature, start: 1.2, end: 1.8 },
}] });
assert.equal(exclusionSuggestion.candidates.find((candidate) => candidate.markerId === 'confirmed-obstruction')?.suggestion?.decision, 'drop', '已确认的画面问题只能形成待审排除建议');
assert.equal(exclusionSuggestion.candidates.find((candidate) => candidate.markerId === 'confirmed-obstruction')?.decision, 'review', '排除建议不得自动生效');

const staleSemantics = createSourceRoughCutPlan('stale', 30, transcript, director, { markerSourceSignature: signature, markers: [{
  id: 'stale-action', label: '旧动作', start: 2.7, end: 3.2, kind: 'action', createdAt: '', visualConfirmed: true,
  semantics: { subject: '', action: '放入', object: '盐', result: '', shot: 'detail', tags: [], method: 'human-observed', reviewedAt: '', sourceSignature: 'old-signature', start: 2.7, end: 3.2 },
}] });
assert.equal(staleSemantics.candidates.some((candidate) => candidate.suggestion), false, '来源失效的视觉语义不得进入联合建议');

let reordered = updateRoughCutDecision(plan, plan.candidates[0].id, 'keep');
reordered = updateRoughCutDecision(reordered, plan.candidates[1].id, 'keep');
reordered = applyRoughCutRoleTemplate(reordered, 'story');
reordered = moveRoughCutCandidate(reordered, plan.candidates[1].id, -1);
assert.deepEqual(acceptedRoughCutCandidates(reordered).map((candidate) => candidate.id), [plan.candidates[1].id, plan.candidates[0].id], '执行顺序应服从导演编排，而不是原片时间');
assert.equal(reordered.assembly?.confirmedAt, undefined, '调整顺序后必须重新确认结构');

assert.deepEqual(visualCheckpointTimes(0.2, 1.8, 2), [0, 0.2, 0.65, 0.55, 1, 1.45, 1.35, 1.8, 1.999]);
assert.deepEqual(waveformWindowPeaks([0, 0.2, 0.4, 0.8, 0.3, 0.1], 6, 2, 5, 3), [0.4, 0.8, 0.3]);

console.log('Rough cut plan checks passed.');
