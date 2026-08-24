import * as XLSX from 'xlsx';
import type { CleanedContentCase, CleaningStats } from './types';

type Row = Record<string, unknown>;
const aliases = {
  creator: ['账号', '博主', '作者', 'creator'],
  title: ['视频标题', '标题', 'title'],
  likes: ['点赞', '点赞数', 'likes'],
  comments: ['评论', '评论数', 'comments'],
  shares: ['转发/分享', '转发', '分享', 'shares'],
  views: ['播放量(你补)', '播放量', '播放', 'views'],
  tags: ['关键词/标签', '标签', 'tags'],
  script: ['口播文字(你补)', '口播全文', '口播文字', '脚本', 'script'],
  hook: ['前三秒钩子', '钩子', 'hook'],
  emotion: ['情绪触发点', '情绪', 'emotion'],
  structure: ['故事结构', '结构', 'structure'],
  conflict: ['冲突', 'conflict'],
  personalNote: ['备注', '个人判断', '我的判断', 'personalNote'],
} as const;

function value(row: Row, keys: readonly string[]): unknown {
  const key = Object.keys(row).find((candidate) => keys.includes(candidate.trim()));
  return key ? row[key] : null;
}

function text(input: unknown): string | null {
  if (input == null) return null;
  const result = String(input).replace(/[\u200b\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
  return result || null;
}

function number(input: unknown): number | null {
  const parsed = Number(String(input ?? '').replace(/[,，]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function tags(input: unknown): string[] {
  return (text(input) ?? '').split(/[,，、|#]/).map((tag) => tag.trim()).filter(Boolean);
}

const AD_WORDS = ['广告', '推广', '合作', '品牌', '旗舰店', '下单', '购买', '优惠', '折扣', '券', '链接', '私信', '直播间', '同款'];

function classifyAd(title: string | null, script: string | null, tagList: string[]) {
  const corpus = [title, script, ...tagList].filter(Boolean).join(' ');
  const hits = AD_WORDS.filter((word) => corpus.includes(word));
  if (!hits.length) return { isAdvertisement: false, adType: null as null, hits };
  const pure = Boolean(script && hits.length >= 2 && script.length < 180) || /广告|推广|合作/.test(title ?? '');
  return { isAdvertisement: true, adType: pure ? 'pure' as const : 'soft' as const, hits };
}

export async function cleanContentWorkbook(file: File): Promise<{ cases: CleanedContentCase[]; stats: CleaningStats }> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = sheet ? XLSX.utils.sheet_to_json<Row>(sheet, { defval: null }) : [];
  const cases = rows.map((row, index) => {
    const title = text(value(row, aliases.title));
    const script = text(value(row, aliases.script));
    const tagList = tags(value(row, aliases.tags));
    const ad = classifyAd(title, script, tagList);
    return {
      id: `content-case-${Date.now()}-${index + 1}`,
      creator: text(value(row, aliases.creator)),
      title,
      script,
      metrics: {
        likes: number(value(row, aliases.likes)),
        comments: number(value(row, aliases.comments)),
        shares: number(value(row, aliases.shares)),
        views: number(value(row, aliases.views)),
      },
      tags: tagList,
      hook: text(value(row, aliases.hook)),
      emotion: text(value(row, aliases.emotion)),
      structure: text(value(row, aliases.structure)),
      conflict: text(value(row, aliases.conflict)),
      personalNote: text(value(row, aliases.personalNote)),
      isAdvertisement: ad.isAdvertisement,
      adType: ad.adType,
      usable: Boolean(title && script && script.length >= 20 && ad.adType !== 'pure'),
    } satisfies CleanedContentCase;
  });
  const tracked = ['creator', 'title', 'script', 'hook', 'emotion', 'structure', 'conflict', 'personalNote'];
  const missing = Object.fromEntries(tracked.map((field) => [field, cases.filter((item) => !item[field as keyof CleanedContentCase]).length]));
  return {
    cases,
    stats: {
      total: cases.length,
      usable: cases.filter((item) => item.usable).length,
      advertisements: cases.filter((item) => item.isAdvertisement).length,
      missing,
    },
  };
}

export default cleanContentWorkbook;
