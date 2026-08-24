import type { DirectorTemplate, DirectorTemplateV2, DirectorTimelineStep } from './types';

const DEFAULT_CAMERA = '真人口播+辅助素材';

function stepAction(label: string, index: number, template: DirectorTemplate): DirectorTimelineStep {
  const normalized = label.trim() || `推进第${index + 1}步`;
  const isHook = index === 0;
  const isEnding = index === template.structure.length - 1;
  const purpose = isHook ? `展示${normalized}，快速建立关注` : isEnding ? `总结${normalized}，推动观众行动` : `展开${normalized}，推进核心信息`;
  const contentAction = isHook ? '用一句口播或画面提出问题、结果或反差' : isEnding ? '给出明确结论、步骤或行动引导' : '用口播拆解信息，并用一个例子完成证明';
  const visualNeed = isHook ? `${DEFAULT_CAMERA}；用与“${normalized}”对应的强画面开场` : `根据“${normalized}”插入案例图片、截图或演示`;
  const emotion = isHook ? (template.emotionalTrigger || '好奇') : template.emotionalTrigger || '理解与获得感';
  return { duration: 0, purpose, emotion, contentAction, visualNeed, subtitleStyle: index === 0 ? '大字钩子，重点词高亮' : '重点词放大，按信息分段显示' };
}

function buildDurations(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [60];
  if (count === 2) return [5, 55];
  const durations = [5];
  const ending = 30;
  const middleCount = count - 2;
  const middleTotal = 60 - durations[0] - ending;
  const base = Math.floor(middleTotal / middleCount);
  for (let i = 0; i < middleCount; i += 1) durations.push(base);
  durations.push(ending + (middleTotal % middleCount));
  return durations;
}

function inferGoal(template: DirectorTemplate): string {
  const contentType = template.contentType || '';
  if (contentType.includes('教程') || contentType.includes('问题')) return '帮助观众理解问题并完成行动';
  if (contentType.includes('观点') || contentType.includes('洞察')) return '建立认知冲击并留下可讨论观点';
  return '用清晰叙事传递核心信息并促成记忆';
}

/** 将抽象导演模板转换为默认 60 秒的可执行分镜步骤。 */
export function refineDirectorTemplates(input: DirectorTemplate[] | unknown): DirectorTemplateV2[] {
  const templates = Array.isArray(input) ? input : [];
  return templates.slice(0, 6).map((template, templateIndex) => {
    const safe = template as DirectorTemplate;
    const structure = Array.isArray(safe.structure) && safe.structure.length ? safe.structure : ['提出问题', '展开说明', '总结行动'];
    const durations = buildDurations(structure.length);
    const timeline = structure.map((label, index) => ({ ...stepAction(String(label), index, { ...safe, structure }), duration: durations[index] })) as DirectorTimelineStep[];
    return {
      id: safe.id || `director-v2-${templateIndex + 1}`,
      name: safe.name || `导演模板${templateIndex + 1}`,
      applicableContent: [...new Set([...(safe.applicableTopics || []), safe.contentType].filter(Boolean))],
      audience: (safe.applicableTopics || []).length ? `关注${safe.applicableTopics.join('、')}的用户` : '对相关主题感兴趣的用户',
      goal: inferGoal(safe),
      timeline,
      hookRule: safe.hook?.rule || '前三秒提出问题、结果或反差',
      middleRule: safe.middle?.rule || '围绕一个核心信息展开解释和证明',
      endingRule: safe.ending?.rule || '总结为清晰的结论或行动建议',
    };
  });
}

export default refineDirectorTemplates;
