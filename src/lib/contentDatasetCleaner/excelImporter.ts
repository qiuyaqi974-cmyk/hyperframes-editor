import type { CleanedContentCase, CleaningStats } from './types';
import {
  normalizedText,
  parseNumber,
  parseTags,
  pickValue,
  readFirstSheetRows,
} from '@/lib/ingest/spreadsheet';

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
  emotion: ['情绪触发器', '情绪', 'emotion'],
  structure: ['故事结构', '结构', 'structure'],
  conflict: ['冲突', 'conflict'],
  personalNote: ['备注', '个人判断', '我的判断', 'personalNote'],
} as const;

const AD_WORDS = ['广告', '推广', '合作', '品牌', '旗舰店', '下单', '购买', '优惠', '折扣', '链接', '私信', '直播间', '同款'];

function classifyAd(title: string | null, script: string | null, tagList: string[]) {
  const corpus = [title, script, ...tagList].filter(Boolean).join(' ');
  const hits = AD_WORDS.filter((word) => corpus.includes(word));
  if (!hits.length) return { isAdvertisement: false, adType: null as null, hits };
  const pure = Boolean(script && hits.length >= 2 && script.length < 180) || /广告|推广|合作/.test(title ?? '');
  return { isAdvertisement: true, adType: pure ? 'pure' as const : 'soft' as const, hits };
}

export async function cleanContentWorkbook(file: File): Promise<{ cases: CleanedContentCase[]; stats: CleaningStats }> {
  const rows = await readFirstSheetRows(file);
  const cases = rows.map((row, index) => {
    const title = normalizedText(pickValue(row, aliases.title));
    const script = normalizedText(pickValue(row, aliases.script));
    const tagList = parseTags(pickValue(row, aliases.tags));
    const ad = classifyAd(title, script, tagList);
    return {
      id: `content-case-${Date.now()}-${index + 1}`,
      creator: normalizedText(pickValue(row, aliases.creator)),
      title,
      script,
      metrics: {
        likes: parseNumber(pickValue(row, aliases.likes)),
        comments: parseNumber(pickValue(row, aliases.comments)),
        shares: parseNumber(pickValue(row, aliases.shares)),
        views: parseNumber(pickValue(row, aliases.views)),
      },
      tags: tagList,
      hook: normalizedText(pickValue(row, aliases.hook)),
      emotion: normalizedText(pickValue(row, aliases.emotion)),
      structure: normalizedText(pickValue(row, aliases.structure)),
      conflict: normalizedText(pickValue(row, aliases.conflict)),
      personalNote: normalizedText(pickValue(row, aliases.personalNote)),
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
