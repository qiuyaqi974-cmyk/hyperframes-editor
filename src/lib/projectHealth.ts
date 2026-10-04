import { normalizeDirectorDecision, sceneDecisionFor } from '@/lib/directorDecision';
import type { Block, ProjectSnapshot, Scene } from '@/types';
import { reviewFor } from '@/lib/sceneReview';
import { sourceStoryAssemblyReadiness } from '@/lib/sourceStoryAssembly';
import { sourceStoryAssemblyVersionSignature } from '@/lib/sourceStoryVersions';
import { analyzeOtio } from '@/lib/otioTimeline';

export type ProjectHealthSeverity = 'blocker' | 'warning' | 'director';
export type ProjectHealthFix = 'sync-subtitle' | 'sync-voice-duration';

export interface ProjectHealthIssue {
  id: string;
  severity: ProjectHealthSeverity;
  title: string;
  detail: string;
  sceneId?: string;
  blockId?: string;
  time?: number;
  fix?: ProjectHealthFix;
}

export interface ProjectHealthReport {
  status: 'blocked' | 'risky' | 'ready';
  issues: ProjectHealthIssue[];
  blockers: ProjectHealthIssue[];
  warnings: ProjectHealthIssue[];
  directorIssues: ProjectHealthIssue[];
  fixableCount: number;
}

const EPSILON = 0.15;
const VISUAL_TYPES = new Set<Block['type']>(['image', 'video', 'text', 'card', 'chart', 'scrollstory']);

function add(
  issues: ProjectHealthIssue[],
  severity: ProjectHealthSeverity,
  id: string,
  title: string,
  detail: string,
  target: Partial<Pick<ProjectHealthIssue, 'sceneId' | 'blockId' | 'time' | 'fix'>> = {},
) {
  issues.push({ id, severity, title, detail, ...target });
}

function sceneLabel(scene: Scene) {
  return `场景 ${Math.max(1, scene.index)}`;
}

function textFor(block: Block) {
  if (block.type === 'text' || block.type === 'subtitle' || block.type === 'scrollstory' || block.type === 'voice') {
    return block.props.text;
  }
  if (block.type === 'card') return `${block.props.eyebrow} ${block.props.title} ${block.props.body}`;
  if (block.type === 'chart') return `${block.props.title} ${block.props.labels}`;
  return '';
}

function significantTerms(value: string) {
  const chunks = value.toLowerCase().split(/[\s，。！？、；：,.!?;:()（）【】\[\]"“”'‘’/\\-]+/).filter(Boolean);
  const terms = new Set(chunks.filter((chunk) => chunk.length >= 2));
  const chinese = value.replace(/[^\u4e00-\u9fff]/g, '');
  for (let index = 0; index < chinese.length - 1; index += 2) terms.add(chinese.slice(index, index + 2));
  return [...terms];
}

/** 纯函数体检器：既供 UI 使用，也作为最终交付的统一质量门禁。 */
export function analyzeProjectHealth(snapshot: ProjectSnapshot): ProjectHealthReport {
  const issues: ProjectHealthIssue[] = [];
  const scenes = [...snapshot.scenes].sort((a, b) => a.start - b.start);
  const sceneMap = new Map(scenes.map((scene) => [scene.id, scene]));
  const assetMap = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  const sourceMediaMap = new Map((snapshot.sourceMedia ?? []).map((source) => [source.id, source]));
  const director = normalizeDirectorDecision(snapshot.director);
  const reviews = snapshot.reviews ?? {};

  if (snapshot.storyAssembly) {
    const assembly = snapshot.storyAssembly;
    const assemblyHealth = sourceStoryAssemblyReadiness(assembly, snapshot.sourceMedia ?? [], director.updatedAt);
    const applied = Boolean(assembly.appliedBlockIds?.length);
    if (applied && (assemblyHealth.signaturesStale || assemblyHealth.directorStale || assemblyHealth.missingItems || assemblyHealth.missingRoles)) {
      add(issues, 'blocker', 'story-assembly-stale', '已装配的跨原片结构已经过期', '源粗剪决定或导演 Brief 已变化。请撤销旧装配、同步全局候选并重新确认。');
    }
    if (applied && !assemblyHealth.previewReviewed) {
      add(issues, 'blocker', 'story-preview-unreviewed', '已装配结构缺少有效预演确认', '正式装配前的低码率预览或逐切点确认已经缺失、过期或未完成。');
    } else if (!applied && (!assembly.confirmedAt || assemblyHealth.signaturesStale || assemblyHealth.directorStale || !assemblyHealth.previewReviewed)) {
      add(issues, 'director', 'story-assembly-unconfirmed', '跨原片故事结构尚未完成预演', '它不会阻止当前时间轴交付，但这份全局粗剪草案还不能执行。');
    }
    if (applied) {
      const blockIds = new Set(snapshot.blocks.map((block) => block.id));
      const missingBlocks = assembly.appliedBlockIds!.filter((id) => !blockIds.has(id));
      if (missingBlocks.length) add(issues, 'blocker', 'story-assembly-blocks-missing', '全局装配与时间轴不一致', `有 ${missingBlocks.length} 个已装配片段从时间轴消失；请撤销后重新装配。`);
    }
  }

  const storyVersions = snapshot.storyAssemblyVersions ?? [];
  const selectedTimeline = storyVersions.find((version) => version.id === snapshot.storyVersionSelection?.winnerVersionId)?.externalTimeline;
  if (selectedTimeline) {
    try {
      const reasons = analyzeOtio(selectedTimeline.document).blockers;
      if (reasons.length) add(issues, 'blocker', 'otio-render-unsupported', '外部时间线尚不能在本机完整还原', `包含${reasons.join('、')}。请在外部工具完成处理后重新导回，不能用扁平预览作为发布依据。`);
    } catch {
      add(issues, 'blocker', 'otio-invalid', '外部时间线记录无效', '请重新导回原 OTIO 文件。');
    }
  }
  if (storyVersions.length >= 2) {
    const selection = snapshot.storyVersionSelection;
    const winner = storyVersions.find((version) => version.id === selection?.winnerVersionId);
    if (!selection) {
      add(issues, 'blocker', 'story-winner-missing', '多个粗剪方案尚未完成导演选版', '请比较方案预览，指定胜出方案并记录选择理由。');
    } else if (!winner) {
      add(issues, 'blocker', 'story-winner-invalid', '胜出方案已经失效', '选版记录引用了不存在的方案，请重新选版。');
    } else {
      const preview = winner.assembly.preview;
      if (!selection.rationale.trim() || !preview?.reviewedAt || preview.boundaries.some((boundary) => boundary.status !== 'approved')) {
        add(issues, 'blocker', 'story-winner-unreviewed', '胜出方案缺少完整评审依据', '胜出方案必须有已确认预览、全部切点通过和明确的选择理由。');
      }
      if (!snapshot.storyAssembly || sourceStoryAssemblyVersionSignature(snapshot.storyAssembly, snapshot.sourceMedia ?? []) !== winner.signature) {
        add(issues, 'blocker', 'story-winner-not-current', '当前全局结构不是胜出方案', '请恢复胜出方案，重新完成视觉检查、结构确认和预演。');
      } else if (!snapshot.storyAssembly.appliedBlockIds?.length) {
        add(issues, 'blocker', 'story-winner-not-applied', '胜出方案尚未正式装配', '请把已确认的胜出方案写入正式时间轴后再冻结发布候选。');
      }
    }
  }

  if (!snapshot.blocks.length) {
    add(issues, 'blocker', 'empty-project', '工程没有可导出的内容', '请先生成场景或添加积木。');
  }

  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const previous = scenes[index - 1];
    if (![scene.start, scene.end, scene.duration].every(Number.isFinite) || scene.start < 0 || scene.duration <= 0) {
      add(issues, 'blocker', `scene-timing-${scene.id}`, `${sceneLabel(scene)}时间无效`, '场景入点必须大于等于 0，时长必须大于 0。', { sceneId: scene.id, time: Math.max(0, scene.start || 0) });
    } else if (Math.abs(scene.end - (scene.start + scene.duration)) > EPSILON) {
      add(issues, 'blocker', `scene-end-${scene.id}`, `${sceneLabel(scene)}结束时间不一致`, '场景 end 与 start + duration 不一致，渲染边界不可靠。', { sceneId: scene.id, time: scene.start });
    }
    if (previous && scene.start < previous.end - EPSILON) {
      const locked = director.scenes[previous.id]?.locked || director.scenes[scene.id]?.locked;
      add(issues, 'blocker', `scene-overlap-${previous.id}-${scene.id}`, locked ? '导演锁定场景发生重叠' : '场景时间发生重叠', `${sceneLabel(previous)}与${sceneLabel(scene)}重叠 ${(previous.end - scene.start).toFixed(2)} 秒。`, { sceneId: scene.id, time: scene.start });
    }

    const sceneBlocks = snapshot.blocks.filter((block) => block.sceneId === scene.id && block.visible);
    const visualBlocks = sceneBlocks.filter((block) => VISUAL_TYPES.has(block.type));
    if (!visualBlocks.length) {
      add(issues, 'warning', `scene-no-visual-${scene.id}`, `${sceneLabel(scene)}没有主体画面`, '当前只有声音、字幕或辅助效果，成片可能出现空镜。', { sceneId: scene.id, time: scene.start });
    } else if (scene.duration > 12 && visualBlocks.length < 2) {
      add(issues, 'warning', `scene-long-hold-${scene.id}`, `${sceneLabel(scene)}画面停留过久`, `${scene.duration.toFixed(1)} 秒内只有一个主体画面，建议增加镜头变化。`, { sceneId: scene.id, blockId: visualBlocks[0].id, time: scene.start });
    }

    const review = reviewFor(reviews, scene.id);
    const unresolved = review.comments.filter((comment) => !comment.resolved);
    if (review.status === 'changes' || review.status === 'redo') {
      add(issues, 'blocker', `review-${review.status}-${scene.id}`, `${sceneLabel(scene)}审片要求${review.status === 'redo' ? '重做' : '修改'}`, unresolved[0]?.text || '完成修改并重新审片后，才能建立新的发布候选。', { sceneId: scene.id, time: unresolved[0]?.time ?? scene.start });
    } else if (review.status === 'approved' && unresolved.length) {
      add(issues, 'warning', `review-approved-open-${scene.id}`, `${sceneLabel(scene)}已通过但仍有未解决批注`, `还有 ${unresolved.length} 条批注未关闭，请确认是否真的完成。`, { sceneId: scene.id, time: unresolved[0].time });
    }
  }

  const pendingReviewCount = scenes.filter((scene) => reviewFor(reviews, scene.id).status === 'pending').length;
  if (pendingReviewCount) add(issues, 'warning', 'review-pending', `还有 ${pendingReviewCount} 个场景未审`, '待审不会阻止试渲染，但最终交付前建议逐场确认。');

  for (const block of snapshot.blocks) {
    const scene = block.sceneId ? sceneMap.get(block.sceneId) : undefined;
    if (![block.start, block.duration].every(Number.isFinite) || block.start < 0 || block.duration <= 0) {
      add(issues, 'blocker', `block-timing-${block.id}`, `${block.name}的时间无效`, '积木入点必须大于等于 0，时长必须大于 0。', { blockId: block.id, sceneId: block.sceneId, time: Math.max(0, block.start || 0) });
      continue;
    }
    if (block.sceneId && !scene) {
      add(issues, 'blocker', `orphan-scene-${block.id}`, `${block.name}引用了不存在的场景`, '该积木的 sceneId 已失效。', { blockId: block.id, time: block.start });
    }

    if (block.type === 'image' || block.type === 'video') {
      const asset = block.props.assetId ? assetMap.get(block.props.assetId) : undefined;
      const source = block.props.src || asset?.url;
      if (!source) {
        add(issues, 'blocker', `media-missing-${block.id}`, `${block.name}缺少媒体`, '图片或视频没有可读取的素材源。', { blockId: block.id, sceneId: block.sceneId, time: block.start });
      } else if (/^https?:\/\//i.test(source) || /^blob:/i.test(source)) {
        add(issues, 'blocker', `media-external-${block.id}`, `${block.name}仍依赖临时或外部链接`, '最终交付需要把媒体导入工程，避免离线渲染失效。', { blockId: block.id, sceneId: block.sceneId, time: block.start });
      }
      if (block.props.assetId && !asset && block.props.src) {
        add(issues, 'warning', `asset-orphan-${block.id}`, `${block.name}的素材引用已失效`, '当前仍可使用积木内的媒体，但素材库引用需要整理。', { blockId: block.id, sceneId: block.sceneId, time: block.start });
      }
      if (block.type === 'video' && block.props.externalSourceId) {
        const localSource = sourceMediaMap.get(block.props.externalSourceId);
        if (!localSource || localSource.status === 'missing') {
          add(issues, 'blocker', `source-missing-${block.id}`, `${block.name}的原片已离线`, '请重新连接本地原片；代理文件不能代替最终渲染原片。', { blockId: block.id, sceneId: block.sceneId, time: block.start });
        } else if ((block.props.sourceOut ?? 0) > localSource.duration + EPSILON) {
          add(issues, 'blocker', `source-range-${block.id}`, `${block.name}的出点超出原片`, '请重新设置选段出点。', { blockId: block.id, sceneId: block.sceneId, time: block.start });
        }
      }
    }

    if (block.type === 'voice') {
      if (!block.props.src || !block.props.generated) {
        add(issues, 'blocker', `voice-missing-${block.id}`, `${block.name}尚未生成配音`, '最终渲染前需要生成可用音频。', { blockId: block.id, sceneId: block.sceneId, time: block.start });
      }
      if (block.props.duration > 0 && Math.abs(block.duration - block.props.duration) > EPSILON) {
        add(issues, 'warning', `voice-duration-${block.id}`, `${block.name}的音频与时间轴不一致`, `音频 ${block.props.duration.toFixed(2)} 秒，积木 ${block.duration.toFixed(2)} 秒。`, { blockId: block.id, sceneId: block.sceneId, time: block.start, fix: block.locked ? undefined : 'sync-voice-duration' });
      }
      if (scene && block.start + Math.max(block.duration, block.props.duration || 0) > scene.end + EPSILON) {
        add(issues, 'blocker', `voice-overflow-${block.id}`, `${block.name}超出场景边界`, '配音会压到下一场景，请先重新排布时间轴。', { blockId: block.id, sceneId: scene.id, time: block.start });
      }
    }

    if (block.type === 'subtitle') {
      if (scene && (Math.abs(block.start - scene.start) > EPSILON || Math.abs(block.duration - scene.duration) > EPSILON)) {
        add(issues, 'warning', `subtitle-sync-${block.id}`, `${block.name}没有对齐场景`, '可安全地把字幕入点与时长同步到所属场景。', { blockId: block.id, sceneId: scene.id, time: block.start, fix: block.locked || director.scenes[scene.id]?.locked ? undefined : 'sync-subtitle' });
      }
      if (block.props.text.trim().length > 44) {
        add(issues, 'warning', `subtitle-long-${block.id}`, `${block.name}单屏文字过长`, '建议拆成两句或两个字幕节奏点，降低阅读压力。', { blockId: block.id, sceneId: block.sceneId, time: block.start });
      }
    }
  }

  const usedAssets = new Set(snapshot.blocks.flatMap((block) => block.type === 'image' || block.type === 'video' ? [block.props.assetId] : []).filter(Boolean));
  const unusedCount = snapshot.assets.filter((asset) => !usedAssets.has(asset.id)).length;
  if (unusedCount) add(issues, 'warning', 'unused-assets', `素材库有 ${unusedCount} 个未使用素材`, '不会影响渲染，但会增加工程和交付包体积。');

  const missingBrief = [director.objective, director.audience, director.thesis].filter((value) => !value.trim()).length;
  if (missingBrief) add(issues, 'director', 'director-brief', '导演 Brief 尚未完整', '目标、受众和核心观点决定 Agent 是否在同一个方向上工作。');

  scenes.forEach((scene, index) => {
    const decision = sceneDecisionFor(director, scene, index, scenes.length);
    if (director.scenes[scene.id] && !decision.intent.trim()) {
      add(issues, 'director', `scene-intent-${scene.id}`, `${sceneLabel(scene)}缺少叙事意图`, '定义观众在这一场景应该理解或感受到什么。', { sceneId: scene.id, time: scene.start });
    }
    if (decision.narrativeRole === 'proof') {
      const hasProofVisual = snapshot.blocks.some((block) => block.sceneId === scene.id && ['image', 'video', 'chart', 'card'].includes(block.type));
      if (!hasProofVisual) add(issues, 'director', `proof-visual-${scene.id}`, `${sceneLabel(scene)}缺少证据画面`, '被标记为“证据”的场景目前没有图片、视频、图表或卡片。', { sceneId: scene.id, time: scene.start });
    }
  });

  const allText = snapshot.blocks.map(textFor).join(' ').toLowerCase();
  const thesisTerms = significantTerms(director.thesis);
  if (director.thesis.trim() && thesisTerms.length && !thesisTerms.some((term) => allText.includes(term))) {
    add(issues, 'director', 'thesis-missing', '核心观点没有落到成片文案', '导演层的核心观点与当前字幕、配音和文字内容缺少明显呼应。');
  }
  if (director.endingAction.trim() && scenes.length) {
    const lastScene = scenes[scenes.length - 1];
    const lastText = snapshot.blocks.filter((block) => block.sceneId === lastScene.id).map(textFor).join(' ').toLowerCase();
    const actionTerms = significantTerms(director.endingAction);
    if (actionTerms.length && !actionTerms.some((term) => lastText.includes(term))) {
      add(issues, 'director', 'ending-action-missing', '结尾没有兑现行动指令', '最后一个场景的文案没有明显承接导演设定的观众行动。', { sceneId: lastScene.id, time: lastScene.start });
    }
  }

  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const directorIssues = issues.filter((issue) => issue.severity === 'director');
  return {
    status: blockers.length ? 'blocked' : issues.length ? 'risky' : 'ready',
    issues,
    blockers,
    warnings,
    directorIssues,
    fixableCount: issues.filter((issue) => issue.fix).length,
  };
}

export function applySafeHealthFixes(snapshot: ProjectSnapshot) {
  const report = analyzeProjectHealth(snapshot);
  const fixes = new Map(report.issues.filter((issue) => issue.fix && issue.blockId).map((issue) => [issue.blockId as string, issue.fix as ProjectHealthFix]));
  let fixedCount = 0;
  const sceneMap = new Map(snapshot.scenes.map((scene) => [scene.id, scene]));
  const blocks = snapshot.blocks.map((block) => {
    const fix = fixes.get(block.id);
    if (!fix || block.locked) return block;
    if (fix === 'sync-subtitle' && block.type === 'subtitle' && block.sceneId) {
      const scene = sceneMap.get(block.sceneId);
      if (!scene) return block;
      fixedCount += 1;
      return { ...block, start: scene.start, duration: scene.duration };
    }
    if (fix === 'sync-voice-duration' && block.type === 'voice' && block.props.duration > 0) {
      fixedCount += 1;
      return { ...block, duration: block.props.duration };
    }
    return block;
  });
  return { snapshot: { ...snapshot, blocks, updatedAt: new Date().toISOString() }, fixedCount };
}

export function formatHealthBlockers(report: ProjectHealthReport, limit = 4) {
  return report.blockers.slice(0, limit).map((issue) => `• ${issue.title}`).join('\n');
}
