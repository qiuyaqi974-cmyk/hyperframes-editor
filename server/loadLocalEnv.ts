import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 统一的本地环境变量加载。
 *
 * Electron 主进程（LLM 调用）和 Vite dev server（讯飞 TTS 代理）
 * 都从这里读取 .env.local，保证两条链路拿到的密钥一致。
 * 已存在的进程环境变量优先，不会被文件覆盖。
 */
export function loadLocalEnv(fileName = '.env.local'): void {
  try {
    const content = readFileSync(join(process.cwd(), fileName), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {
    // .env.local 是可选的，也可以直接在启动前设置环境变量。
  }
}
