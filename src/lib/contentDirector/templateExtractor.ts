import type { DirectorTemplate } from './types';

interface PatternInput {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  structure?: string[];
  hookPatterns?: string[];
  emotionalTriggers?: string[];
  reusableRules?: string[];
}

const FALLBACKS: Array<Pick<DirectorTemplate, 'name' | 'contentType' | 'structure' | 'hook' | 'middle' | 'ending' | 'emotionalTrigger' | 'applicableTopics'>> = [
  { name: 'AI知识教学型', contentType: '知识教学', structure: ['提出错误认知', '解释为什么错误', '给出解决步骤'], hook: { rule: '前三秒制造认知冲突', examples: ['很多人用AI的方法其实错了'] }, middle: { rule: '拆解旧方法的问题' }, ending: { rule: '给具体执行步骤' }, emotionalTrigger: '认知纠正与获得感', applicableTopics: ['AI', '效率', '学习'] },
  { name: '真实故事洞察型', contentType: '故事洞察', structure: ['讲述真实场景', '提炼反常识观点', '回扣普遍人性'], hook: { rule: '用具体细节制造代入感', examples: ['我昨天遇到一件很奇怪的事'] }, middle: { rule: '从故事细节推导核心矛盾' }, ending: { rule: '用一句判断留下余味' }, emotionalTrigger: '共鸣与好奇', applicableTopics: ['情感', '成长', '关系'] },
  { name: '问题拆解型', contentType: '问题解决', structure: ['提出痛点', '拆分关键原因', '给出可执行方案'], hook: { rule: '直接点出观众正在经历的问题', examples: ['为什么你越努力，结果越差？'] }, middle: { rule: '按因果顺序拆解问题' }, ending: { rule: '提供一条今天就能执行的建议' }, emotionalTrigger: '焦虑缓解与掌控感', applicableTopics: ['职场', '效率', '生活'] },
  { name: '观点辩证型', contentType: '观点表达', structure: ['抛出争议观点', '承认常见反对意见', '给出更深一层判断'], hook: { rule: '先说出容易引发争议的结论', examples: ['真正的问题可能和你想的相反'] }, middle: { rule: '回应反对意见并补充边界' }, ending: { rule: '留下可讨论的开放判断' }, emotionalTrigger: '争议与思考', applicableTopics: ['社会', '关系', '认知'] },
  { name: '清单步骤型', contentType: '清单教程', structure: ['说明目标', '列出步骤或清单', '提醒常见误区'], hook: { rule: '承诺一个具体且可验证的结果', examples: ['只要做这三步，马上少走弯路'] }, middle: { rule: '用数字化步骤降低理解成本' }, ending: { rule: '提醒观众立即开始第一步' }, emotionalTrigger: '确定感与行动欲', applicableTopics: ['教程', '工具', '技能'] },
  { name: '反转对比型', contentType: '反转叙事', structure: ['建立常见预期', '展示意外反差', '解释反差背后的原因'], hook: { rule: '先给结果，再制造结果与预期的落差', examples: ['看起来最省事的方法，反而最浪费时间'] }, middle: { rule: '用前后对比证明反转不是偶然' }, ending: { rule: '把反转总结成可复用原则' }, emotionalTrigger: '惊讶与顿悟', applicableTopics: ['消费', '职场', '生活'] },
];

export function extractDirectorTemplates(patterns: PatternInput[]): DirectorTemplate[] {
  const templates = patterns.slice(0, 6).map((pattern, index) => ({
    id: `director-${pattern.id ?? index + 1}`,
    name: pattern.name || `${FALLBACKS[index].name}`,
    sourcePattern: pattern.id ?? `pattern-${index + 1}`,
    contentType: pattern.category || '综合内容',
    structure: pattern.structure?.length ? pattern.structure : FALLBACKS[index].structure,
    hook: {
      rule: pattern.reusableRules?.[0] || FALLBACKS[index].hook.rule,
      examples: pattern.hookPatterns?.length ? pattern.hookPatterns : FALLBACKS[index].hook.examples,
    },
    middle: { rule: pattern.reusableRules?.[1] || '围绕核心冲突展开解释。' },
    ending: { rule: pattern.reusableRules?.[2] || '总结为观众可以复用的行动建议。' },
    emotionalTrigger: pattern.emotionalTriggers?.[0] || '好奇、共鸣与获得感',
    visualStrategy: {
      camera: '真人口播+辅助素材',
      subtitle: '重点词放大',
      scene: '根据内容插入案例图片、截图、演示',
    },
    applicableTopics: [pattern.category || '综合内容'],
  }));
  while (templates.length < 6) {
    const fallback = FALLBACKS[templates.length];
    templates.push({
      ...fallback,
      id: `director-${templates.length + 1}`,
      sourcePattern: `pattern-${templates.length + 1}`,
      visualStrategy: { camera: '真人口播+辅助素材', subtitle: '重点词放大', scene: '根据内容插入案例图片、截图、演示' },
    });
  }
  return templates;
}

export default extractDirectorTemplates;
