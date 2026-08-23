# HyperFrames 可视化积木编辑器 · V4.0.1

> V4.0.1 修复 Windows 启动窗口一闪而过的问题。推荐双击 `START_HYPERFRAMES.cmd`，错误窗口会保留，方便直接截图。

## V4.0 第三轮增强

- 新增鼠标教学积木：移动、点击、双击、拖拽，支持点击波纹和自定义起终点。
- 新增批量素材导入，并按素材文件名与 SRT 字幕关键词自动匹配到对应场景。
- 新增 HTML 转 MP4 工具，可把画面、动画、字幕与配音逐帧合成为 MP4。
- 新增 `一键启动.bat`，Windows 用户双击即可启动，不必输入命令。

### 最简单的使用方法

1. 双击 `一键启动.bat` 打开编辑器。
2. 先导入 SRT，再点左侧“批量导入素材”和“自动匹配到字幕”。
3. 左侧添加 Cursor，设置鼠标动作和终点。
4. 点“导出 MP4”下载渲染 HTML，把下载的文件拖到 `HTML转MP4.bat` 上。
5. MP4 会生成在渲染 HTML 所在的文件夹中。

## V3.1 第二轮增强

- 图表扩展为柱状、折线、面积、环形、进度五种类型，并支持标签、数值、单位和双色配置。
- 新增可独立拖拽、缩放、分层和动画的信息卡片积木。
- 顶栏新增 5 套 HTML 主题：深夜蓝、暖纸杂志、赛博玻璃、红黑社论、极简黑白。
- 主题可一键同步到画布和已有文字、卡片、图表、字幕等元素。
- 导出的单文件 HTML 保留卡片、主题与多元图表样式。

V3.0 把项目从“积木演示器”推进到可恢复、可按配音编排、可输出工程的工作台：

- 工程会自动保存到当前浏览器，刷新后自动恢复。
- 图片、视频改用可持久化数据，JSON 导出后再次导入不会裂图。
- 视频默认作为普通素材，可在画布中移动；选中图片或视频后可拖右下角圆点等比缩放。
- 支持导入配音文件，并在时间轴显示配音轨。
- 支持导入 SRT，自动生成场景轨和逐句字幕。
- 支持导出自包含 HyperFrames HTML；打开即可预览，也提供 `window.__HF_SEEK(t)` 供逐帧渲染调用。

## V3.0 推荐流程

1. 输入工程名称。
2. 导入配音。
3. 导入配套 SRT，工作台自动建立场景和字幕时间轴。
4. 导入截图、图片或视频，拖动到需要的位置并调整时间片段。
5. 导出 JSON 保存完整工程；导出 HTML 交给 HyperFrames 渲染或直接预览。

像搭积木一样组合视觉模块，实时看到效果的「视觉效果编排器」。

> V1 = 搭积木→改参→实时预览 闭环。V2 补齐编排能力（多层级、图层拖拽、动画曲线、JSON 存取）。
> V2.1 = 在不重构的前提下新增 5 个高级积木：Spotlight / GlassUI / Chart / ScrollStory / Subtitle。

## 启动

```bash
cd hyperframes-editor
npm install
npm run dev
```

打开 http://localhost:5178

如果 `npm install` 卡住不动（默认源在国内经常拉不动）：

```bash
npm install --registry=https://registry.npmmirror.com
```

其它命令：

```bash
npm run typecheck   # TS 类型检查
npm run build       # 类型检查 + 生产构建
npm run preview     # 预览构建产物
```

## 布局

```
┌────────────────────────────────────────────────────────┐
│ 顶栏：导入/导出 JSON · 载入示例 / 清空 / 快捷键          │
├──────────┬────────────────────────────┬────────────────┤
│ 积木库    │                            │  Inspector     │
│ 素材库    │      实时预览 Canvas        │  属性编辑       │
│ 图层(Layers)│    (1920×1080 等比缩放)   │  缓动曲线预览   │
│ ├ 拖拽排序│                            │                │
│ ├ 可见/锁定│                            │                │
├──────────┴────────────────────────────┴────────────────┤
│ Timeline：播放头 / 轨道 / clip 拖动 / 裁剪 / 双击入点      │
└────────────────────────────────────────────────────────┘
```

## 核心设计：画面 = f(blocks, t)

与 HyperFrames「HTML 即视频」的契约对齐，做了三个硬性约束：

1. **确定性求值**。`src/lib/animation.ts` 的 `evaluateBlock(block, t)` 是纯函数，
   任意时间点都能算出画面。**没有用 CSS transition / 自跑 keyframes** —— 那类动画
   一旦 seek 就会漂移，无法帧精确导出。
2. **播放与渲染解耦**。播放引擎只负责把时间往前推，"播放"和"手拖播放头"走完全
   相同的渲染路径。
3. **媒体播放权归播放头**。`<video>` 不自己播，由 `VideoBlock` 根据 `localTime`
   驱动 seek/play/pause，保证音画与时间轴严格对齐。

每个积木 DOM 上都带 `data-block / data-type / data-start / data-duration`，
与 HyperFrames 「DOM 用 data-\* 声明时序」同构，为后续导出合成 HTML 留好接口。

## 数据结构

```ts
{
  id: string,
  type: 'image' | 'text' | 'video' | 'spotlight' | 'glassui' | 'chart' | 'scrollstory' | 'subtitle',
  name: string,
  props: {},              // 类型专属参数
  animation: {            // 入场动画声明
    type, duration, delay, easing, direction, distance, from
  },
  position: { x, y },     // 合成坐标（1920×1080 基准）
  start: number,          // 时间轴入点（秒）
  duration: number,       // 持续时长（秒）
  layer: number,
  visible: boolean,
  locked: boolean
}
```

> `start` 是在原始约定上补的一个字段 —— 没有它，Timeline 无法表达"第几秒出现"。

## 目录

```
src/
  components/
    blocks/
      ImageBlock.tsx      图片积木（纯外观）
      TextBlock.tsx       文字积木（纯外观）
      VideoBlock.tsx      视频积木（含播放头托管）
      SpotlightBlock.tsx  聚光积木（径向渐变压暗 + 亮洞）
      GlassUIBlock.tsx    玻璃拟态卡片（backdrop-filter 毛玻璃）
      ChartBlock.tsx      图表积木（SVG 柱状 / 折线）
      ScrollStoryBlock.tsx 滚动故事（文字随 localTime 上滚）
      SubtitleBlock.tsx   字幕条（底部居中 + 半透明底衬）
      BlockRenderer.tsx   统一套壳：定位 / 动画 / 选中 / 拖拽 / data-*
    canvas/EditorCanvas.tsx
    timeline/Timeline.tsx
    sidebar/BlockLibrary.tsx
    sidebar/LayersPanel.tsx   图层面板（拖拽排序 + 可见/锁定）
    inspector/PropertyPanel.tsx
    ui/Field.tsx          数字框 / 滑杆 / 分段 / 色板 / 开关
  store/editorStore.ts    Zustand 单一数据源
  lib/
    animation.ts          确定性求值器 + 缓动
    blockFactory.ts       积木工厂 + 默认值
    assets.ts             文件 → 可持久化素材（data URL + 尺寸探测）
  types.ts
```

## 快捷键

| 键 | 作用 |
| --- | --- |
| `空格` | 播放 / 暂停 |
| `← / →` | 逐帧步进（按住 Shift 为 1 秒） |
| `Delete` | 删除选中积木 |
| `Ctrl / Cmd + D` | 复制积木 |
| `Esc` | 取消选中 |

## V2 新增（保持架构，未重构）

1. **多层级管理 · LayersPanel**：左侧图层列表按 `layer` 降序排列，与画布
   叠加顺序一致；每行可切换「可见 / 锁定」，状态与画布实时联动
   （`BlockRenderer` 已尊重 `locked` 与 `visible`）。
2. **积木拖拽排序**：图层面板内用 HTML5 拖拽（无额外依赖）整体重排层级，
   `store.setLayerOrder(ids)` 按给定顺序重排 `layer`。Inspector 里原有的
   「上移 / 下移」按钮仍保留作为键盘党备选。
3. **动画参数编辑增强**：Inspector 的 Animation 区新增 **缓动曲线 SVG 预览**，
   选 `linear / easeOut / easeInOut / spring` 时肉眼看到动画「怎么动」。
   动画参数（type/duration/delay/easing/direction/distance/from）V1 已具备，
   V2 只补可视化，未改数据结构。
4. **JSON 导入 / 导出**：顶栏「导出 JSON」下载工程文件、「导入 JSON」读回。
   快照含 `canvas / blocks / assets`（见 `types.ts` 的 `ProjectSnapshot`）。
5. **Timeline 增强**：双击 clip 直接跳到该积木入点，方便反复看动画。

## V2.1 新增：5 个高级积木（独立组件，保持架构，未重构）

全部走已有的「积木组件 + BlockRenderer 套壳 + 工厂 + store」模式，新增类型与现有
`evaluateBlock` 时间驱动求值 / 图层 / 时间轴完全兼容：

| 积木 | 类型 | 说明 | 关键参数 |
| --- | --- | --- | --- |
| **SpotlightBlock** | `spotlight` | 径向渐变在画面上挖一个亮洞、其余压暗，引导视线 | 半径 / 羽化 / 暗度 / 染色 |
| **GlassUIBlock** | `glassui` | 玻璃拟态卡片，`backdrop-filter` 模糊其下方内容 | 尺寸 / 圆角 / 模糊 / 底色 / 描边 |
| **ChartBlock** | `chart` | SVG 柱状 / 折线图，数据来自逗号分隔字符串 | 类型 / 数据 / 颜色 / 标题 / 网格 |
| **ScrollStoryBlock** | `scrollstory` | 一段文字按 `localTime × speed` 匀速上滚，故事化字幕 | 文本 / 字号 / 速度 / 背景 |
| **SubtitleBlock** | `subtitle` | 底部居中的字幕条，带半透明底衬（文本型，auto 高度） | 文本 / 字号 / 底衬 / 内边距 |

设计要点：
- **仍是时间驱动、可 seek**。尤其 `ScrollStoryBlock` 的滚动偏移 = `frame.localTime × speed`，
  不是 CSS 自跑动画，拖播放头 / 逐帧导出都不会漂移（与 V1 的硬约束一致）。
- **GlassUI 的毛玻璃**依赖浏览器实时合成 `backdrop-filter`，需叠在视频 / 图片等
  背景内容之上才看得到磨砂；导出成静态帧时这一层模糊需用离屏快照还原（已知边界，未做）。
- 每种积木都自带合理的默认尺寸与入场动画，加完即可在右侧 Inspector 调参、在 Timeline 看效果。

## 已知边界

- 只有入场动画，没有出场动画和关键帧。
- 没有撤销重做。
- 当前导出 HyperFrames HTML，MP4 仍由后续渲染步骤生成。
- 大体积视频以内联数据保存，工程 JSON 和 HTML 文件也会相应变大。
