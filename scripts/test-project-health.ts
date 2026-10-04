import assert from 'node:assert/strict';
import { analyzeProjectHealth, applySafeHealthFixes } from '../src/lib/projectHealth';
import { scenePlanToSnapshot, type ScenePlan } from '../src/lib/agent/scenePlan';

const plan: ScenePlan = {
  projectName: '体检测试',
  scenes: [
    { id: 'scene-1', duration: 4, blocks: [{ type: 'voice', content: '先抓住注意力', duration: 4 }, { type: 'subtitle', content: '先抓住注意力', duration: 4 }] },
    { id: 'scene-2', duration: 5, blocks: [{ type: 'text', content: '证据与结论', duration: 5 }] },
  ],
};

const broken = scenePlanToSnapshot(plan);
broken.director = {
  objective: '',
  audience: '',
  thesis: '',
  contentType: 'knowledge',
  tone: '',
  pacing: 'balanced',
  emotionArc: '',
  endingAction: '',
  visualRules: '',
  scenes: {},
  updatedAt: '',
};
const subtitle = broken.blocks.find((block) => block.type === 'subtitle');
assert(subtitle);
subtitle.start += 0.8;
subtitle.duration -= 0.8;

const brokenReport = analyzeProjectHealth(broken);
assert.equal(brokenReport.status, 'blocked');
assert(brokenReport.blockers.some((issue) => issue.id.startsWith('voice-missing-')));
assert(brokenReport.warnings.some((issue) => issue.id.startsWith('subtitle-sync-')));
assert(brokenReport.directorIssues.some((issue) => issue.id === 'director-brief'));
assert.equal(brokenReport.fixableCount, 1);

const repaired = applySafeHealthFixes(broken);
assert.equal(repaired.fixedCount, 1);
const repairedSubtitle = repaired.snapshot.blocks.find((block) => block.id === subtitle.id);
assert(repairedSubtitle);
assert.equal(repairedSubtitle.start, broken.scenes[0].start);
assert.equal(repairedSubtitle.duration, broken.scenes[0].duration);

subtitle.locked = true;
const lockedRepair = applySafeHealthFixes(broken);
assert.equal(lockedRepair.fixedCount, 0);

for (const block of broken.blocks) {
  if (block.type === 'voice') {
    block.props.src = 'data:audio/mpeg;base64,SUQz';
    block.props.generated = true;
    block.props.duration = block.duration;
  }
}
broken.director.objective = '让观众理解证据';
broken.director.audience = 'AI 叙事创作者';
broken.director.thesis = '证据与结论';
broken.director.scenes = {
  'scene-1': { sceneId: 'scene-1', narrativeRole: 'hook', intent: '抓住注意力', visualRule: '', locked: false },
  'scene-2': { sceneId: 'scene-2', narrativeRole: 'cta', intent: '给出结论', visualRule: '', locked: false },
};
subtitle.locked = false;
subtitle.start = broken.scenes[0].start;
subtitle.duration = broken.scenes[0].duration;
const deliverable = analyzeProjectHealth(broken);
assert.equal(deliverable.blockers.length, 0);

broken.storyAssembly = {
  version: 1, generatedAt: '', directorUpdatedAt: 'older-director', sourceSignatures: {}, items: [], confirmedAt: '', appliedAt: '', appliedBlockIds: ['missing-global-block'],
};
const staleAssembly = analyzeProjectHealth(broken);
assert(staleAssembly.blockers.some((issue) => issue.id === 'story-assembly-stale'));
assert(staleAssembly.blockers.some((issue) => issue.id === 'story-assembly-blocks-missing'));
assert(staleAssembly.blockers.some((issue) => issue.id === 'story-preview-unreviewed'));

console.log('Project health checks passed.');
