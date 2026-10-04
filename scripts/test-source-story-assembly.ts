import assert from 'node:assert/strict';
import {
  applySourceStoryTemplate,
  confirmSourceStoryAssembly,
  createSourceStoryAssembly,
  moveSourceStoryItem,
  refreshSourceStoryAssembly,
  removeSourceStoryItem,
  replaceSourceStoryItem,
  reviseSourceStoryBoundary,
  sourceStoryAssemblyReadiness,
} from '../src/lib/sourceStoryAssembly';
import type { DirectorDecision, ExternalMediaSource, SourceRoughCutCandidate } from '../src/types';

const director: DirectorDecision = {
  objective: '把多机位做饭素材剪成清晰教程', audience: '新手', thesis: '先准备再下锅', contentType: 'tutorial',
  tone: '自然', pacing: 'balanced', emotionArc: '', endingAction: '', visualRules: '', scenes: {}, updatedAt: 'director-v1',
};

function candidate(id: string, text: string, start: number): SourceRoughCutCandidate {
  return {
    id, text, start, end: start + 2, decision: 'keep', boundary: 'word', origin: 'speech', pauseBefore: null, pauseAfter: null,
    reason: '测试', visualReview: { status: 'approved', checkedAt: '', windowStart: start, windowEnd: start + 2 },
  };
}

function source(id: string, name: string, candidates: SourceRoughCutCandidate[]): ExternalMediaSource {
  return {
    id, name, path: `D:/${name}.mp4`, duration: 60, width: 1920, height: 1080, size: 100, status: 'original', createdAt: '',
    transcript: candidates.map((item) => ({ id: `transcript-${item.id}`, start: item.start + 0.05, end: item.end - 0.08, text: item.text, words: [{ start: item.start + 0.05, end: item.end - 0.08, word: item.text }] })),
    roughCutPlan: {
      version: 1, sourceId: id, generatedAt: `${id}-plan-v1`,
      strategy: { pauseThreshold: 0.45, paddingBefore: 0.05, paddingAfter: 0.08, pacing: 'balanced', objective: director.objective, thesis: director.thesis, directorUpdatedAt: director.updatedAt },
      candidates, assembly: { order: candidates.map((item) => item.id) },
    },
  };
}

const sources = [
  source('a', '机位A', [candidate('a1', '先把锅烧热', 1), candidate('a2', '然后加入食用油', 6)]),
  source('b', '机位B', [candidate('b1', '先把锅烧热。', 3)]),
];

let assembly = createSourceStoryAssembly(sources, director, new Date('2026-09-19T00:00:00.000Z'));
assert.equal(assembly.items.length, 3);
let readiness = sourceStoryAssemblyReadiness(assembly, sources, director.updatedAt);
assert.equal(readiness.sourceCount, 2);
assert.equal(readiness.duplicates.length, 1, '跨原片的近似台词应提示，但不能自动删除');
assert.equal(readiness.missingRoles, 3);

assembly = applySourceStoryTemplate(assembly, 'tutorial');
assembly = moveSourceStoryItem(assembly, 2, -1);
assert.equal(assembly.items[1].candidateId, 'b1', '全局顺序必须能跨原片调整');
assembly = removeSourceStoryItem(assembly, 1);
assert.equal(assembly.items.length, 2, '用户可从全局故事中移除片段而不改变源候选');
assert.equal(sources[1].roughCutPlan?.candidates[0].decision, 'keep');

assembly = confirmSourceStoryAssembly(assembly, sources, director.updatedAt, new Date('2026-09-19T00:01:00.000Z'));
readiness = sourceStoryAssemblyReadiness(assembly, sources, director.updatedAt);
assert.equal(readiness.ready, false, '未完整审看结构预览时不得正式装配');
assembly = { ...assembly, preview: { path: 'D:/preview.mp4', duration: readiness.duration, generatedAt: '', structureFingerprint: readiness.structureFingerprint, boundaries: [{ outputTime: 2, beforeIndex: 0, afterIndex: 1, status: 'approved' }], reviewedAt: '2026-09-19T00:02:00.000Z' } };
readiness = sourceStoryAssemblyReadiness(assembly, sources, director.updatedAt);
assert.equal(readiness.ready, true);

const replaced = replaceSourceStoryItem(assembly, 0, 'b', 'b1');
assert.equal(replaced.items[0].candidateId, 'b1');
assert.equal(replaced.items[0].narrativeRole, assembly.items[0].narrativeRole, '替换候选时应保留这个位置的导演职责');
assert.equal(replaced.preview, undefined);

const revised = reviseSourceStoryBoundary(assembly, sources, director, 0, 'end', 0.05);
assert.equal(revised.sources[0].roughCutPlan?.candidates[0].end, 3.05);
assert.equal(revised.sources[0].roughCutPlan?.candidates[0].visualReview, undefined, '切点微调后必须重新视觉检查');
assert.equal(revised.assembly.confirmedAt, undefined);
assert.equal(revised.assembly.preview, undefined);
assert.equal(sourceStoryAssemblyReadiness(revised.assembly, revised.sources, director.updatedAt).signaturesStale, false, '在修订闭环内应同步新的源签名');

const changedSources = sources.map((item) => item.id === 'a' ? { ...item, roughCutPlan: { ...item.roughCutPlan!, candidates: item.roughCutPlan!.candidates.map((entry) => entry.id === 'a2' ? { ...entry, decision: 'drop' as const } : entry) } } : item);
assert.equal(sourceStoryAssemblyReadiness(assembly, changedSources, director.updatedAt).signaturesStale, true, '任一源粗剪变化都应使全局确认过期');
assembly = refreshSourceStoryAssembly(assembly, changedSources, director);
assert.equal(assembly.confirmedAt, undefined);
assert.equal(assembly.items.some((item) => item.candidateId === 'a2'), false);

console.log('Source story assembly checks passed.');
