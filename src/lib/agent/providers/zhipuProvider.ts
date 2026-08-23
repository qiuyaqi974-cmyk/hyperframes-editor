import type { LLMProvider } from '@/lib/agent/llmProvider';

const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const REQUEST_TIMEOUT_MS = 30_000;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // 模型可能在 JSON 前后附带说明，继续扫描完整对象。
  }

  const start = candidate.indexOf('{');
  if (start < 0) throw new Error('智谱返回中没有找到 ScenePlan JSON。');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const json = candidate.slice(start, index + 1);
        try {
          JSON.parse(json);
          return json;
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('智谱返回中没有找到有效的 ScenePlan JSON。');
}

/** 可注入 ProductVideoAgent 的智谱 Chat Completions Provider。 */
export class ZhipuProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string = import.meta.env.VITE_ZHIPU_API_KEY,
    private readonly model = 'glm-4-flash',
  ) {}

  async generate(prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('未配置 VITE_ZHIPU_API_KEY，无法调用智谱。');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(ZHIPU_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: '只输出合法 JSON。JSON 必须是 ScenePlan：包含 projectName、可选 canvas，以及 scenes 数组；每个 scene 包含 id、duration、blocks；每个 block 包含 type、content、duration，可选 layoutPreset。不要输出 Markdown 或额外说明。',
            },
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let payload: {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string | null } }>;
      } = {};
      try {
        payload = JSON.parse(responseText) as typeof payload;
      } catch {
        // 非 JSON 响应仍保留原文，便于诊断网关或鉴权错误。
      }
      if (!response.ok) {
        console.error('智谱 API 错误响应：', responseText);
        throw new Error(`智谱请求失败：${payload.error?.message ?? `HTTP ${response.status}`}`);
      }
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error('智谱没有返回内容。');
      return extractJson(content);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('智谱请求超过 30 秒仍未响应，请检查网络或 API 服务状态。');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

export { extractJson };
