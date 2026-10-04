# OTIO 时间线往返

本阶段实现 OTIO JSON 公开格式；FCPXML 线性主故事线另见 `docs/fcpxml-interchange.md`。仍不解析剪映私有草稿。

## 使用

1. 在“粗剪方案版本 → 公开时间线（OTIO）”导出方案，或在胜出方案精剪交接包中取得 `timeline.otio`。
2. 在支持 OTIO 的外部工具中编辑。保留 `metadata.hyperframes.originVersionId`，以及已有片段的 `sourceId`、`candidateId`；素材使用绝对本地路径或 `file:` URL。
3. 点击“导回 EDL / OTIO”，选择 `.otio` 文件。所有 OTIO 导入均先进入收件箱，由用户确认差异后保存不可变派生方案。工程内新片段仍需来源、边界、九帧视觉与叙事职责审核。
4. 派生方案的“重新导出完整 OTIO”保留导入的轨道、片段顺序、原始有理时间、转场、正向线性速度和附带元数据；重新导出的父来源指向该派生方案。

## 支持范围与门禁

- `Timeline.1 → Stack.1 → Track.1`，Video / Audio 轨道，`Clip.1` / `Clip.2`、`ExternalReference.1`、`Gap.1`、`Transition.1` 和正数 `LinearTimeWarp.1`。
- 混合帧率按各自 RationalTime 转换；原片非零起始时间码按 available_range 起点归一化。原始 JSON 数值不重写。
- 验证每个媒体引用、来源 ID、原片时长、逐词边界；转场检查额外句柄，正向变速按保守素材包络校验，不把包络误作渲染结果。
- 拒绝新片段后，以等长 Gap 替换所有对应引用，并移除相邻转场，其他轨道位置不移动。原始导入文档与拒绝理由仍留在收件箱。
- 单轨视频、无间隙、无转场、原速且无禁用片段的方案可恢复到本机流程，重新完成视觉检查、结构预演及选版。
- 多轨、音轨、转场、变速、间隙、重复素材范围、禁用片段或非零时间线起始码：支持审核、持久化和重新导出；当前本机渲染器不能忠实还原，故阻止扁平化恢复及 RC 发布。切点差异是审核清单，其片段时长相加不代表多轨成片时长。
- 嵌套/裁切轨道、轨道级效果、非线性速度、倒放、定格、图像序列、离线引用、相对路径等未支持情况明确拒绝，不静默降级。
- 导入文件上限沿用 5MB；缺少父来源标识的第三方时间线需要先在外部工具以本工程导出的 OTIO 为基础编辑。

## 验证

`npm run test:otio` 覆盖导入/导出、复杂时间线原始字段保留、批准/拒绝/待审、转场句柄、错误素材、词内切点、时间码、持久化和恢复/RC 门禁。

独立格式校验：安装 OpenTimelineIO 0.18.1 到临时环境，设置 `OTIO_CHECK_DIR` 后运行 `test:otio` 生成测试文件，再以该 Python 环境运行 `scripts/test-otio-sdk.py <临时目录>`。测试环境不是编辑器运行依赖。

浏览器验证：同样生成测试文件，启动 Vite 到 `http://127.0.0.1:5199` 后运行 `node scripts/test-otio-ui.mjs`（可用 `OTIO_TEST_URL` 指定其他本机地址）。测试在独立无头 Edge 环境中导入 OTIO、保存并重新下载，不读写用户浏览器的工程数据。

## 格式依据

- https://opentimelineio.readthedocs.io/en/v0.18.1/tutorials/time-ranges.html
- https://opentimelineio.readthedocs.io/en/v0.18.1/tutorials/otio-serialized-schema.html

OTIO 的转场不推进轨道游标；LinearTimeWarp 不自动修改所属 Item 的时长。实现与官方 SDK 的读取/序列化结果交叉验证。
