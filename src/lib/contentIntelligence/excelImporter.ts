import type { ContentCase } from './types';
import {
  parseNumber,
  parseTags,
  pickValue,
  readFirstSheetRows,
  trimText,
} from '@/lib/ingest/spreadsheet';

const FIELD_ALIASES: Record<keyof Omit<ContentCase, 'id'>, string[]> = {
  title: ['标题', 'title', '内容标题'],
  author: ['账号', '作者', 'author'],
  platform: ['平台', 'platform'],
  likes: ['点赞', '点赞数', 'likes'],
  tags: ['标签', 'tags', '分类'],
  script: ['口播全文', '脚本', 'script', '文案'],
  hook: ['前三秒钩子', '钩子', 'hook'],
  emotion: ['情绪触发器', '情绪', 'emotion'],
  structure: ['故事结构', '结构', 'structure'],
  conflict: ['冲突', 'conflict'],
  personalNote: ['个人判断', '个人笔记', 'personalNote'],
};

export async function importContentCases(file: File): Promise<ContentCase[]> {
  const rows = await readFirstSheetRows(file);
  return rows.map((row, index) => {
    const rawLikes = parseNumber(pickValue(row, FIELD_ALIASES.likes));
    return {
      id: `case-${Date.now()}-${index + 1}`,
      title: trimText(pickValue(row, FIELD_ALIASES.title)) || `未命名案例 ${index + 1}`,
      author: trimText(pickValue(row, FIELD_ALIASES.author)) || undefined,
      platform: trimText(pickValue(row, FIELD_ALIASES.platform)) || undefined,
      likes: rawLikes ?? undefined,
      tags: parseTags(pickValue(row, FIELD_ALIASES.tags)),
      script: trimText(pickValue(row, FIELD_ALIASES.script)),
      hook: trimText(pickValue(row, FIELD_ALIASES.hook)) || undefined,
      emotion: trimText(pickValue(row, FIELD_ALIASES.emotion)) || undefined,
      structure: trimText(pickValue(row, FIELD_ALIASES.structure)) || undefined,
      conflict: trimText(pickValue(row, FIELD_ALIASES.conflict)) || undefined,
      personalNote: trimText(pickValue(row, FIELD_ALIASES.personalNote)) || undefined,
    };
  });
}

export default importContentCases;
