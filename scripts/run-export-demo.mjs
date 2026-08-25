/**
 * 冒烟测试第一步：用编辑器 demo 工程生成一份导出 HTML。
 *
 * 因为 exportHtml.ts 使用了 Vite 的 ?raw 导入，这里通过 esbuild
 * 打包后执行（esbuild 插件提供与 Vite 一致的 ?raw 语义）。
 *
 * 运行：node scripts/run-export-demo.mjs <输出路径>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2];
if (!out) {
  console.error('用法：node scripts/run-export-demo.mjs <输出路径>');
  process.exit(1);
}

const rawPlugin = {
  name: 'vite-raw-loader',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => {
      const cleaned = args.path.startsWith('@/')
        ? path.join(root, 'src', args.path.slice(2))
        : path.resolve(args.resolveDir, args.path);
      return { path: cleaned, namespace: 'raw' };
    });
    build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
      contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'),
      loader: 'text',
    }));
  },
};

const outfile = path.join(root, 'node_modules', '.cache', 'export-demo.mjs');
fs.mkdirSync(path.dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'export-demo.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@': path.join(root, 'src') },
  plugins: [rawPlugin],
  outfile,
  logLevel: 'silent',
});

await import(pathToFileURL(outfile).href);
