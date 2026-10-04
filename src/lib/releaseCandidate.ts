import { analyzeProjectHealth } from '@/lib/projectHealth';
import type { Block, ProjectSnapshot } from '@/types';

export interface ReleaseCandidateHealth {
  status: 'blocked' | 'risky' | 'ready';
  blockers: number;
  warnings: number;
  directorIssues: number;
}

export interface ReleaseCandidate {
  id: string;
  version: number;
  label: string;
  projectName: string;
  createdAt: string;
  snapshot: ProjectSnapshot;
  health: ReleaseCandidateHealth;
  /** RC 冻结时绑定的导演选版结论。 */
  storyDecision?: {
    versionId: string;
    label: string;
    rationale: string;
    selectedAt: string;
  };
  /** 渲染完成后追加的交付凭证；不会改写冻结快照。 */
  render?: {
    outputPath: string;
    reportPath: string;
    sha256: string;
    renderedAt: string;
  };
}

export interface ReleaseComparison {
  changed: boolean;
  blocks: { added: number; removed: number; changed: number };
  scenes: { added: number; removed: number; changed: number };
  assetsDelta: number;
  durationDelta: number;
  healthDelta: { blockers: number; warnings: number; directorIssues: number };
  directorChanged: boolean;
  reviewChanged: boolean;
  storyDecisionChanged: boolean;
}

function durationOf(snapshot: ProjectSnapshot) {
  const blockEnd = snapshot.blocks.reduce((max, block) => Math.max(max, block.start + block.duration), 0);
  const sceneEnd = snapshot.scenes.reduce((max, scene) => Math.max(max, scene.end), 0);
  return Math.max(blockEnd, sceneEnd, snapshot.narration?.duration ?? 0);
}

function comparableBlock(block: Block) {
  const props = { ...block.props } as Record<string, unknown>;
  // 媒体 data URL 往往很大；只取轻量指纹，避免每次编辑都复制整段媒体内容。
  const source = typeof props.src === 'string' ? props.src : '';
  props.src = source ? `${source.length}:${source.slice(0, 48)}:${source.slice(-48)}` : null;
  return JSON.stringify({
    type: block.type,
    name: block.name,
    props,
    animation: block.animation,
    position: block.position,
    start: block.start,
    duration: block.duration,
    layer: block.layer,
    visible: block.visible,
    locked: block.locked,
    sceneId: block.sceneId,
    layoutPreset: block.layoutPreset,
  });
}

function mapDiff<T>(before: T[], after: T[], idOf: (value: T) => string, signature: (value: T) => string) {
  const oldMap = new Map(before.map((value) => [idOf(value), signature(value)]));
  const newMap = new Map(after.map((value) => [idOf(value), signature(value)]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, value] of newMap) {
    if (!oldMap.has(id)) added += 1;
    else if (oldMap.get(id) !== value) changed += 1;
  }
  for (const id of oldMap.keys()) if (!newMap.has(id)) removed += 1;
  return { added, removed, changed };
}

export function healthSummary(snapshot: ProjectSnapshot): ReleaseCandidateHealth {
  const report = analyzeProjectHealth(snapshot);
  return {
    status: report.status,
    blockers: report.blockers.length,
    warnings: report.warnings.length,
    directorIssues: report.directorIssues.length,
  };
}

/** 发布候选一经创建便只读；继续修改会产生新的 RC，而不是覆盖历史。 */
export function createReleaseCandidate(
  snapshot: ProjectSnapshot,
  existing: ReleaseCandidate[] = [],
  now = new Date(),
): ReleaseCandidate {
  const version = existing.reduce((max, candidate) => Math.max(max, candidate.version), 0) + 1;
  const createdAt = now.toISOString();
  const frozen = structuredClone({ ...snapshot, updatedAt: createdAt });
  const winner = frozen.storyAssemblyVersions?.find((item) => item.id === frozen.storyVersionSelection?.winnerVersionId);
  return {
    id: `rc-${now.getTime().toString(36)}-${version}`,
    version,
    label: `RC-${String(version).padStart(3, '0')}`,
    projectName: snapshot.projectName,
    createdAt,
    snapshot: frozen,
    health: healthSummary(frozen),
    ...(winner && frozen.storyVersionSelection ? { storyDecision: {
      versionId: winner.id,
      label: winner.label,
      rationale: frozen.storyVersionSelection.rationale,
      selectedAt: frozen.storyVersionSelection.selectedAt,
    } } : {}),
  };
}

export function compareWithReleaseCandidate(current: ProjectSnapshot, candidate: ReleaseCandidate): ReleaseComparison {
  const blocks = mapDiff(candidate.snapshot.blocks, current.blocks, (block) => block.id, comparableBlock);
  const scenes = mapDiff(
    candidate.snapshot.scenes,
    current.scenes,
    (scene) => scene.id,
    (scene) => JSON.stringify(scene),
  );
  const currentHealth = healthSummary(current);
  const healthDelta = {
    blockers: currentHealth.blockers - candidate.health.blockers,
    warnings: currentHealth.warnings - candidate.health.warnings,
    directorIssues: currentHealth.directorIssues - candidate.health.directorIssues,
  };
  const assetsDelta = current.assets.length + (current.sourceMedia?.length ?? 0)
    - candidate.snapshot.assets.length - (candidate.snapshot.sourceMedia?.length ?? 0);
  const durationDelta = Number((durationOf(current) - durationOf(candidate.snapshot)).toFixed(2));
  const directorChanged = JSON.stringify(current.director ?? null) !== JSON.stringify(candidate.snapshot.director ?? null);
  const reviewChanged = JSON.stringify(current.reviews ?? {}) !== JSON.stringify(candidate.snapshot.reviews ?? {});
  const storyDecisionChanged = JSON.stringify({ versions: current.storyAssemblyVersions ?? [], selection: current.storyVersionSelection ?? null })
    !== JSON.stringify({ versions: candidate.snapshot.storyAssemblyVersions ?? [], selection: candidate.snapshot.storyVersionSelection ?? null });
  const changed = blocks.added + blocks.removed + blocks.changed + scenes.added + scenes.removed + scenes.changed > 0
    || assetsDelta !== 0
    || durationDelta !== 0
    || directorChanged
    || reviewChanged
    || storyDecisionChanged;
  return { changed, blocks, scenes, assetsDelta, durationDelta, healthDelta, directorChanged, reviewChanged, storyDecisionChanged };
}
