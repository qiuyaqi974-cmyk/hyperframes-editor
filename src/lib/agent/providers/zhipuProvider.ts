import type { LLMProvider } from '@/lib/agent/llmProvider';

const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const REQUEST_TIMEOUT_MS = 30_000;

function isDevelopment(): boolean {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const nodeEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return viteEnv?.DEV === true || nodeEnv?.NODE_ENV !== 'production';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function defaultApiKey(): string {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const nodeEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return viteEnv?.VITE_ZHIPU_API_KEY ?? nodeEnv?.VITE_ZHIPU_API_KEY ?? '';
}

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
    private readonly apiKey: string = defaultApiKey(),
    private readonly model = 'glm-4-flash',
  ) {}

  async generate(prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('未配置 VITE_ZHIPU_API_KEY，无法调用智谱。');

    const startedAt = Date.now();
    const assetCount = (prompt.match(/"assetId"\s*:/g) ?? []).length;
    const hasImage = /"kind"\s*:\s*"image"/i.test(prompt);
    const hasVideo = /"kind"\s*:\s*"video"/i.test(prompt);
    console.log('[zhipu] request start');
    console.log('[zhipu] model:', this.model);
    console.log('[zhipu] prompt length:', prompt.length);
    console.log('[zhipu] assets count:', assetCount);
    console.log('[zhipu] has image:', hasImage);
    console.log('[zhipu] has video:', hasVideo);
    if (isDevelopment()) {
      console.log('----- ZHIPU PROMPT START -----');
      console.log(prompt);
      console.log('----- ZHIPU PROMPT END -----');
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await globalThis.fetch(ZHIPU_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          max_tokens: 2000,
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
        console.log('[zhipu] success cost', `${Date.now() - startedAt} ms`);
        return extractJson(content);
      } catch (error) {
        lastError = error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
          ? new Error('智谱请求超过 30 秒仍未响应，请检查网络或 API 服务状态。')
          : error;
        console.error(`[zhipu] attempt ${attempt + 1} failed`, lastError);
        if (attempt < 2) await delay(attempt === 0 ? 2000 : 5000);
      } finally {
        globalThis.clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('智谱请求失败。');
  }
}

export { extractJson };
