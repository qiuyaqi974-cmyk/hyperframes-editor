import ExcelJS from 'exceljs';

/**
 * Excel 导入共享内核。
 *
 * contentIntelligence 与 contentDatasetCleaner 两个领域都要
 * 「读第一个 sheet → 按中文列名别名取字段 → 清洗成文本/数字/标签」，
 * 这里提供唯一的实现，避免解析规则各自漂移。
 *
 * 使用 exceljs 解析（xlsx@0.18.5 存在原型污染与 ReDoS 漏洞，已移除）。
 */

export type XlsxRow = Record<string, unknown>;

/** 把 exceljs 的单元格值归一成原始值（处理富文本 / 公式结果 / 超链接） */
function plainCellValue(value: ExcelJS.CellValue): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join('');
  }
  if ('result' in value) return plainCellValue((value as { result?: ExcelJS.CellValue }).result ?? null);
  if ('text' in value && typeof (value as { text?: unknown }).text === 'string') {
    return (value as { text: string }).text;
  }
  if ('error' in value) return null;
  return value;
}

/** 读取 Excel 第一个 sheet 的全部行（首行为表头，键自动 trim） */
export async function readFirstSheetRows(file: File): Promise<XlsxRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers = new Map<number, string>();
  sheet.getRow(1).eachCell((cell, col) => {
    const key = plainCellValue(cell.value);
    if (key != null && String(key).trim()) headers.set(col, String(key).trim());
  });

  const rows: XlsxRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const item: XlsxRow = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = headers.get(col);
      if (!key) return;
      const cellValue = plainCellValue(cell.value);
      if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
        item[key] = cellValue;
        hasValue = true;
      }
    });
    if (hasValue) rows.push(item);
  });
  return rows;
}

/** 按别名列表匹配行里的列 */
export function pickValue(row: XlsxRow, aliases: readonly string[]): unknown {
  const key = Object.keys(row).find((candidate) => aliases.includes(candidate.trim()));
  return key ? row[key] : undefined;
}

/** 仅 trim 的文本（contentIntelligence 语义） */
export function trimText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

/** 归一化文本：去零宽字符、折叠空白；空串返回 null（contentDatasetCleaner 语义） */
export function normalizedText(value: unknown): string | null {
  if (value == null) return null;
  const result = String(value)
    .replace(/[\u200b\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return result || null;
}

/** 解析数字：去掉千分位逗号；非法返回 null */
export function parseNumber(value: unknown): number | null {
  const parsed = Number(String(value ?? '').replace(/[,，]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** 解析标签：按中英文逗号、顿号、竖线、井号切分 */
export function parseTags(value: unknown): string[] {
  return (trimText(value) || '')
    .split(/[,，、|#]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}
