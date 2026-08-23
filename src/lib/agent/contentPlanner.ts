export interface ContentScene {
  text: string;
  visual: string;
  duration: number;
}

export interface ContentPlan {
  title: string;
  script: string;
  scenes: ContentScene[];
}

/**
 * 本地内容规划 MVP：先用稳定模板建立“主题 → 内容计划”的接口，
 * 后续可以把函数内部替换成真实模型调用，输出契约保持不变。
 */
export function planContent(topic: string): ContentPlan {
  const subject = topic.trim();
  if (!subject) throw new Error('主题不能为空。');

  const title = `${subject}：先理解这三个关键点`;
  const scenes: ContentScene[] = [
    {
      text: `很多人正在讨论“${subject}”，但真正重要的不是追热点，而是先弄清楚它到底解决什么问题。`,
      visual: '标题卡片 + 主题关键词高亮',
      duration: 4,
    },
    {
      text: `理解“${subject}”可以先抓住三个关键点：它是什么、为什么值得关注，以及它会怎样影响你的下一步选择。`,
      visual: '三点结构卡片 + 简单流程图',
      duration: 7,
    },
    {
      text: `如果你只记住一句话：先用一个小场景验证“${subject}”，再决定是否投入更多时间和资源。`,
      visual: '结论字幕 + 行动提示',
      duration: 5,
    },
  ];

  return {
    title,
    script: scenes.map((scene) => scene.text).join('\n\n'),
    scenes,
  };
}
