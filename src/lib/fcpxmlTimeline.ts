import { otioPath } from '@/lib/otioTimeline';
import type { ImportedEdl } from '@/lib/sourceStoryRoundtrip';
import type { ExternalMediaSource, NarrativeRole, SourceStoryAssemblyVersion } from '@/types';

const FCPXML_VERSION = '1.10';
const narrativeRoles = new Set<NarrativeRole>(['hook', 'context', 'argument', 'proof', 'turn', 'cta', 'custom']);
type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[] };

function xml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
}

function decodeXml(value: string) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseAttributes(value: string) {
  const attrs: Record<string, string> = {};
  let cursor = 0;
  const pattern = /\s+([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/gy;
  while (cursor < value.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(value);
    if (!match) {
      if (/^\s*$/.test(value.slice(cursor))) break;
      throw new Error('FCPXML 标签属性格式无效。');
    }
    const key = match[1];
    if (key in attrs) throw new Error(`FCPXML 属性 ${key} 重复。`);
    const raw = match[3] ?? match[4] ?? '';
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(raw)) throw new Error('FCPXML 含未知 XML 实体。');
    attrs[key] = decodeXml(raw);
    cursor = pattern.lastIndex;
  }
  return attrs;
}

/** Small non-executing parser for the deliberately narrow HyperFrames FCPXML profile. */
export function parseFcpxml(text: string): XmlNode {
  if (new TextEncoder().encode(text).byteLength > 5 * 1024 * 1024) throw new Error('FCPXML 超过 5MB 安全上限。');
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) throw new Error('FCPXML 不接受实体声明或内嵌 DTD。');
  const clean = text.replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/i, '').replace(/<!DOCTYPE\s+fcpxml\s*>/i, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<!DOCTYPE/i.test(clean)) throw new Error('FCPXML 文档类型声明无效。');
  const roots: XmlNode[] = []; const stack: XmlNode[] = [];
  const tags = /<([^>]+)>/g; let cursor = 0; let match: RegExpExecArray | null;
  while ((match = tags.exec(clean))) {
    if (clean.slice(cursor, match.index).trim()) throw new Error('FCPXML 不接受标签外文本。');
    cursor = tags.lastIndex;
    const body = match[1].trim();
    if (!body || body.startsWith('!') || body.startsWith('?')) throw new Error('FCPXML 含不支持的声明。');
    if (body.startsWith('/')) {
      const name = body.slice(1).trim(); const node = stack.pop();
      if (!node || node.name !== name) throw new Error('FCPXML 标签没有正确闭合。');
      continue;
    }
    const selfClosing = body.endsWith('/'); const content = selfClosing ? body.slice(0, -1).trim() : body;
    const nameMatch = /^([A-Za-z_][\w:.-]*)/.exec(content); if (!nameMatch) throw new Error('FCPXML 标签名无效。');
    const node: XmlNode = { name: nameMatch[1], attrs: parseAttributes(content.slice(nameMatch[0].length)), children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node); else roots.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (clean.slice(cursor).trim() || stack.length || roots.length !== 1) throw new Error('FCPXML 文档结构不完整。');
  return roots[0];
}

function only(node: XmlNode, name: string, required = true) {
  const matches = node.children.filter((child) => child.name === name);
  if (matches.length > 1 || (required && matches.length !== 1)) throw new Error(`FCPXML ${name} 节点数量无效。`);
  return matches[0];
}
function assertChildren(node: XmlNode, allowed: string[]) {
  const unknown = node.children.find((child) => !allowed.includes(child.name));
  if (unknown) throw new Error(`FCPXML 暂不支持 ${node.name} 中的 ${unknown.name}；不会丢弃后继续导入。`);
}
function time(value: string | undefined, label: string) {
  if (!value) throw new Error(`FCPXML ${label} 缺失。`);
  const match = /^(\d+)(?:\/(\d+))?s$/.exec(value);
  if (!match) throw new Error(`FCPXML ${label} 时间格式无效。`);
  const denominator = Number(match[2] ?? 1); const seconds = Number(match[1]) / denominator;
  if (!Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(denominator) || denominator <= 0 || !Number.isFinite(seconds)) throw new Error(`FCPXML ${label} 时间无效。`);
  return seconds;
}
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }
function fcpxTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('FCPXML 导出时间无效。');
  const numerator = Math.round(seconds * 1_000_000); const divisor = gcd(numerator, 1_000_000);
  return divisor === 1_000_000 ? `${numerator / divisor}s` : `${numerator / divisor}/${1_000_000 / divisor}s`;
}
function frameDuration(fps: number) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('FCPXML 导出帧率无效。');
  for (const denominator of [24000, 30000, 60000, 120000]) if (Math.abs(fps - denominator / 1001) < 1e-6) return `1001/${denominator}s`;
  if (Math.abs(fps - Math.round(fps)) < 1e-9) return `1/${Math.round(fps)}s`;
  const denominator = Math.round(fps * 1_000_000); const divisor = gcd(1_000_000, denominator);
  return `${1_000_000 / divisor}/${denominator / divisor}s`;
}
function fileUrl(path: string) {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('//')) { const [host, ...parts] = normalized.slice(2).split('/'); return `file://${host}/${parts.map(encodeURIComponent).join('/')}`; }
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized.split('/').map((part, index) => index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/')}`;
}
function metadata(node: XmlNode) {
  const container = only(node, 'metadata', false); if (!container) return {};
  assertChildren(container, ['md']); const values: Record<string, string> = {};
  for (const md of container.children) {
    const key = md.attrs.key; if (!key || typeof md.attrs.value !== 'string') throw new Error('FCPXML metadata 项缺少 key 或 value。');
    if (key in values) throw new Error(`FCPXML metadata 键 ${key} 重复。`);
    values[key] = md.attrs.value;
  }
  return values;
}

export function createFcpxmlTimeline(version: SourceStoryAssemblyVersion, sources: ExternalMediaSource[], projectName: string, fps = 30) {
  if (!version.segments.length) throw new Error('FCPXML 导出方案没有片段。');
  const used = [...new Set(version.segments.map((segment) => segment.sourceId))].map((sourceId) => {
    const source = sources.find((item) => item.id === sourceId); if (!source) throw new Error(`FCPXML 导出原片 ${sourceId} 缺失。`);
    if (!Number.isFinite(source.width) || source.width <= 0 || !Number.isFinite(source.height) || source.height <= 0) throw new Error(`FCPXML 导出原片 ${source.name} 的画面尺寸无效。`);
    return source;
  });
  const resourceIds = new Map(used.map((source, index) => [source.id, `r${index + 2}`]));
  const resources = used.map((source) => `    <asset id="${resourceIds.get(source.id)}" name="${xml(source.name)}" start="0s" duration="${fcpxTime(source.duration)}" hasVideo="1" hasAudio="1" format="r1" audioSources="1" audioChannels="2" audioRate="48000">\n      <media-rep kind="original-media" src="${xml(fileUrl(source.path))}"/>\n    </asset>`).join('\n');
  let cursor = 0;
  const clips = version.segments.map((segment) => {
    const duration = segment.end - segment.start; if (duration <= 0) throw new Error('FCPXML 导出片段时长无效。');
    const attrs = `name="${xml(segment.sourceName)}" ref="${resourceIds.get(segment.sourceId)}" offset="${fcpxTime(cursor)}" start="${fcpxTime(segment.start)}" duration="${fcpxTime(duration)}" audioRole="dialogue"`;
    cursor += duration;
    return `          <asset-clip ${attrs}>\n            <metadata>\n              <md key="com.hyperframes.sourceId" value="${xml(segment.sourceId)}"/>\n              <md key="com.hyperframes.candidateId" value="${xml(segment.candidateId)}"/>\n              <md key="com.hyperframes.narrativeRole" value="${xml(segment.narrativeRole ?? '')}"/>\n              <md key="com.hyperframes.text" value="${xml(segment.text)}"/>\n            </metadata>\n          </asset-clip>`;
  }).join('\n');
  const primary = used[0];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="${FCPXML_VERSION}">\n  <resources>\n    <format id="r1" frameDuration="${frameDuration(fps)}" width="${primary.width}" height="${primary.height}" colorSpace="1-1-1 (Rec. 709)"/>\n${resources}\n  </resources>\n  <event name="${xml(projectName)}">\n    <project name="${xml(projectName)}">\n      <metadata><md key="com.hyperframes.originVersionId" value="${xml(version.id)}"/></metadata>\n      <sequence format="r1" duration="${fcpxTime(cursor)}" tcStart="0s" tcFormat="NDF">\n        <spine>\n${clips}\n        </spine>\n      </sequence>\n    </project>\n  </event>\n</fcpxml>\n`;
}

export function fcpxmlToEdl(text: string, base: SourceStoryAssemblyVersion, sources: ExternalMediaSource[]): ImportedEdl {
  const root = parseFcpxml(text); if (root.name !== 'fcpxml' || root.attrs.version !== FCPXML_VERSION) throw new Error(`只支持 FCPXML ${FCPXML_VERSION}。`);
  assertChildren(root, ['resources', 'event']);
  const resources = only(root, 'resources'); const event = only(root, 'event'); assertChildren(resources, ['format', 'asset']); assertChildren(event, ['project']);
  const assets = new Map<string, { path: string; duration: number }>();
  for (const asset of resources.children.filter((node) => node.name === 'asset')) {
    const id = asset.attrs.id; if (!id || assets.has(id)) throw new Error('FCPXML 素材资源 ID 缺失或重复。');
    assertChildren(asset, ['media-rep']); const representation = only(asset, 'media-rep');
    if (representation.attrs.kind !== 'original-media') throw new Error('FCPXML 只接受 original-media 本地原片引用。');
    assets.set(id, { path: otioPath(representation.attrs.src), duration: time(asset.attrs.duration, '素材时长') });
  }
  const project = only(event, 'project'); assertChildren(project, ['metadata', 'sequence']);
  const projectMetadata = metadata(project); if (projectMetadata['com.hyperframes.originVersionId'] !== base.id) throw new Error('FCPXML 缺少当前父胜出方案标识或来源版本不匹配。');
  const sequence = only(project, 'sequence'); assertChildren(sequence, ['spine']); const spine = only(sequence, 'spine'); assertChildren(spine, ['asset-clip']);
  const paths: Record<string, string> = {}; const aliases = new Map<string, string>(); let cursor = 0;
  const ranges: ImportedEdl['ranges'] = spine.children.map((clip, index) => {
    assertChildren(clip, ['metadata']); const asset = assets.get(clip.attrs.ref); if (!asset) throw new Error(`FCPXML 第 ${index + 1} 段引用未知素材资源。`);
    const offset = time(clip.attrs.offset ?? fcpxTime(cursor), `第 ${index + 1} 段时间线位置`); const start = time(clip.attrs.start, `第 ${index + 1} 段入点`); const duration = time(clip.attrs.duration, `第 ${index + 1} 段时长`);
    if (duration <= 0 || start + duration > asset.duration + 0.05) throw new Error(`FCPXML 第 ${index + 1} 段切点越界。`);
    if (Math.abs(offset - cursor) > 0.001) throw new Error('FCPXML 当前只支持无间隙、无重叠的主故事线；不会静默压平时间线。'); cursor = offset + duration;
    const info = metadata(clip); const sourceId = info['com.hyperframes.sourceId']; const candidateId = info['com.hyperframes.candidateId'];
    const source = sources.find((item) => item.id === sourceId) ?? sources.find((item) => item.path.replace(/\\/g, '/').toLowerCase() === asset.path.replace(/\\/g, '/').toLowerCase());
    if (!source || source.path.replace(/\\/g, '/').toLowerCase() !== asset.path.replace(/\\/g, '/').toLowerCase()) throw new Error(`FCPXML 第 ${index + 1} 段引用工程外素材或路径错版。`);
    let alias = aliases.get(source.id); if (!alias) { alias = `S${aliases.size + 1}`; aliases.set(source.id, alias); paths[alias] = source.path; }
    const roleValue = info['com.hyperframes.narrativeRole']; const beat = narrativeRoles.has(roleValue as NarrativeRole) ? roleValue as NarrativeRole : undefined;
    return { source: alias, sourceId: source.id, ...(candidateId ? { candidateId } : {}), start, end: start + duration, label: clip.attrs.name ?? source.name, ...(beat ? { beat } : {}), ...(typeof info['com.hyperframes.text'] === 'string' ? { quote: info['com.hyperframes.text'] } : {}) };
  });
  if (!ranges.length) throw new Error('FCPXML 主故事线没有可审核片段。');
  if (sequence.attrs.duration && Math.abs(time(sequence.attrs.duration, '时间线时长') - cursor) > 0.001) throw new Error('FCPXML 时间线声明时长与主故事线不一致。');
  return { version: 1, kind: 'hyperframes-story-edl', metadata: { originVersionId: base.id }, sources: paths, ranges };
}
