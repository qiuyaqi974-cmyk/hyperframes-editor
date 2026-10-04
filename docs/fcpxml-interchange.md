# FCPXML 时间线往返

HyperFrames 支持 FCPXML 1.10 的可验证线性主故事线。它用于把已冻结方案交给 Final Cut Pro 或兼容工具继续精剪，再把顺序、切点、职责和工程内新增片段送回现有差异审核流程。

## 使用

1. 在“粗剪方案版本 → 公开时间线（OTIO / FCPXML）”导出单个方案，或从胜出方案精剪交接包取得 `timeline.fcpxml`。
2. 外部编辑时保留项目和片段中的 `com.hyperframes.*` metadata。素材继续使用绝对本地 `file:` URL，不复制原片。
3. 点击“导回 EDL / OTIO / FCPXML”。系统先验证来源版本、素材路径、时间和结构，再显示版本差异；不会直接覆盖胜出方案或正式时间轴。
4. 工程内新增片段进入原有收件箱，必须完成人工来源确认、边界确认、九帧视觉检查、叙事职责和最终决定。保存后仍需恢复派生方案并重新预演、审片和选版。

## 首版支持范围

- 根格式固定为 FCPXML 1.10，输出 `resources → format/asset` 与 `event → project → sequence → spine → asset-clip`。
- 使用官方有理秒表示；常见 23.976、29.97、59.94 和 119.88 帧率输出准确的 `1001/Ns` frameDuration。
- 主故事线只接受连续的 `asset-clip`：无间隙、无重叠、无转场、无变速、无连接片段和独立音轨。
- 每个片段保留来源 ID、候选 ID、叙事职责与文本；项目保留父方案 ID。元数据缺失的工程内片段作为新增片段进入人工审核，不会静默冒充原候选。
- 导入只接受绝对本地路径或 `file:` URL，检查工程内来源、素材时长、片段范围和逐词安全边界。工程外素材与路径错版直接阻断。
- XML 只按文本解析，不执行内容；5 MB 上限，拒绝实体声明、内嵌 DTD、未知实体、错误闭合及首版范围外的结构。

复杂多轨、转场、速度和间隙时间线继续使用 OTIO 保存与重导。FCPXML 首版遇到这些结构会明确拒绝，不会把它们压平成看似可恢复的线性切点。

## 验证

```powershell
npm run test:fcpxml
npm run test:fcpxml-ui
```

领域测试覆盖 FCPXML 1.10 结构、有理时间、本地 URL、XML 转义、导出/导入、改序、新增片段审核、来源记录，以及格式、版本、路径、时间线结构、文件大小和 XML 实体门禁。浏览器测试在隔离 Edge 环境中验证真实文件导入、差异保存、父版本不变、FCPXML provenance 和重新下载。

格式依据：Apple Developer 的 [Creating FCPXML Documents](https://developer.apple.com/documentation/professional-video-applications/creating-fcpxml-documents) 与 [Describing Final Cut Pro Items in FCPXML](https://developer.apple.com/documentation/professional-video-applications/describing-final-cut-pro-items-in-fcpxml)。
