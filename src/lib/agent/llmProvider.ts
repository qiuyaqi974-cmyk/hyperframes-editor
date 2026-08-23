export interface LLMProvider {
  generate(prompt: string): Promise<string>;
}

/** 默认的本地 Provider：用于验证 Prompt 与 JSON 协议，不连接任何模型服务。 */
export class MockProvider implements LLMProvider {
  constructor(private readonly response: string = '{"scenes":[]}') {}

  async generate(_prompt: string): Promise<string> {
    return this.response;
  }
}
