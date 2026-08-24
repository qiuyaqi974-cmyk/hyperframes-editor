import * as XLSX from 'xlsx';
import type { ContentCase } from './types';

type Row = Record<string, unknown>;

const FIELD_ALIASES: Record<keyof Omit<ContentCase, 'id'>, string[]> = {
  title: ['标题', 'title', '内容标题'],
  author: ['账号', '作者', 'author'],
  platform: ['平台', 'platform'],
  likes: ['点赞', '点赞数', 'likes'],
  tags: ['标签', 'tags', '分类'],
  script: ['口播全文', '脚本', 'script', '文案'],
  hook: ['前三秒钩子', '钩子', 'hook'],
  emotion: ['情绪触发点', '情绪', 'emotion'],
  structure: ['故事结构', '结构', 'structure'],
  conflict: ['冲突', 'conflict'],
  personalNote: ['个人判断', '个人笔记', 'personalNote'],
};

function readField(row: Row, aliases: string[]): unknown {
  const key = Object.keys(row).find((candidate) => aliases.includes(candidate.trim()));
  return key ? row[key] : undefined;
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export async function importContentCases(file: File): Promise<ContentCase[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '' });
  return rows.map((row, index) => {
    const tagsText = text(readField(row, FIELD_ALIASES.tags));
    const rawLikes = Number(String(readField(row, FIELD_ALIASES.likes) ?? '').replace(/[,，]/g, ''));
    return {
      id: `case-${Date.now()}-${index + 1}`,
      title: text(readField(row, FIELD_ALIASES.title)) || `未命名案例 ${index + 1}`,
      author: text(readField(row, FIELD_ALIASES.author)) || undefined,
      platform: text(readField(row, FIELD_ALIASES.platform)) || undefined,
      likes: Number.isFinite(rawLikes) ? rawLikes : undefined,
      tags: tagsText ? tagsText.split(/[,，、|]/).map((tag) => tag.trim()).filter(Boolean) : [],
      script: text(readField(row, FIELD_ALIASES.script)),
      hook: text(readField(row, FIELD_ALIASES.hook)) || undefined,
      emotion: text(readField(row, FIELD_ALIASES.emotion)) || undefined,
      structure: text(readField(row, FIELD_ALIASES.structure)) || undefined,
      conflict: text(readField(row, FIELD_ALIASES.conflict)) || undefined,
      personalNote: text(readField(row, FIELD_ALIASES.personalNote)) || undefined,
    };
  });
}

export default importContentCases;
