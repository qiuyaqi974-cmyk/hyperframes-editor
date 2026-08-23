import type { LLMProvider } from '@/lib/agent/llmProvider';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();

  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // Continue with a balanced-object scan for responses with explanatory text.
  }

  const start = candidate.indexOf('{');
  if (start < 0) throw new Error('OpenAI 返回中没有找到 ScenePlan JSON。');

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
  throw new Error('OpenAI 返回中没有找到有效的 ScenePlan JSON。');
}

/** 可注入 ProductVideoAgent 的 OpenAI Chat Completions Provider。 */
export class OpenAIProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string = import.meta.env.VITE_OPENAI_API_KEY,
    private readonly model = 'gpt-4o-mini',
  ) {}

  async generate(prompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('未配置 VITE_OPENAI_API_KEY，无法调用 OpenAI。');
    }

    const response = await fetch(OPENAI_CHAT_URL, {
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
    });

    const payload = await response.json() as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    if (!response.ok) {
      throw new Error(`OpenAI 请求失败：${payload.error?.message ?? `HTTP ${response.status}`}`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI 没有返回内容。');
    return extractJson(content);
  }
}

export { extractJson };
