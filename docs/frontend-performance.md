# 前端拆包与首屏加载

编辑器核心保持同步加载。以下功能按用户操作加载：

- 点击“AI 助手”后加载导演决策、长素材、生产流程、审核、体检和 RC 工作台。
- 展开“高级工具与实验入口”后加载实验工具。
- 选择 Excel 工作簿并开始解析时才加载 ExcelJS。展开高级工具不会下载解析器。
- 点击“导出 HTML”后加载内嵌播放器代码；它不进入编辑器首屏。

“渲染 RC”仍通过事件打开 AI 工作台。加载中显示明确占位，不会绕过项目体检、人工视觉门禁、原片引用或 RC 冻结规则。

## 构建基线

2026-09-20 生产构建：首屏 JavaScript 约 271 KB（拆分前约 1.79 MB）；AI 工作台约 173 KB；高级工具约 40 KB；HTML 导出模块约 250 KB；ExcelJS 约 939 KB。ExcelJS 是独立、按需功能包，因此构建警告阈值设为 1000 KB。其他模块若重新膨胀到该量级仍会产生警告；专项测试另外强制首屏 JavaScript 小于 500 KB。

`npm run test:frontend-chunks` 读取 Vite manifest，验证首屏体积和模块边界。生产构建启动 `vite preview` 后，运行 `node scripts/test-frontend-chunks-ui.mjs`；也可用 `FRONTEND_CHUNKS_TEST_URL` 指定地址。浏览器测试确认首屏不请求可选包、AI 工作台与高级工具按交互加载、ExcelJS 保持未加载，以及 RC 快捷入口仍可打开工作台。
