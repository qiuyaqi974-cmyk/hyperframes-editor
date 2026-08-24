import type { ContentCase, ContentPattern } from './types';

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

/** 第一版规则分析器：按标签/结构聚合案例，未来可替换为 LLM 实现。 */
export function analyzeCases(cases: ContentCase[]): ContentPattern[] {
  const groups = new Map<string, ContentCase[]>();
  for (const item of cases) {
    const category = item.tags?.[0] || item.structure || '未分类';
    groups.set(category, [...(groups.get(category) ?? []), item]);
  }
  return [...groups.entries()].map(([category, group], index) => {
    const hooks = unique(group.map((item) => item.hook));
    const structures = unique(group.map((item) => item.structure));
    const emotions = unique(group.map((item) => item.emotion));
    return {
      id: `pattern-${index + 1}`,
      name: `${category}内容模式`,
      category,
      description: `从 ${group.length} 个案例中提取的${category}模式。`,
      structure: structures.length ? structures : ['开头钩子', '核心内容', '行动引导'],
      hookPatterns: hooks,
      emotionalTriggers: emotions,
      reusableRules: [
        '前三秒先提出明确问题或结果。',
        '每个场景只表达一个核心信息。',
        `优先复用“${category}”相关的表达方式。`,
      ],
    } satisfies ContentPattern;
  });
}

export default analyzeCases;
