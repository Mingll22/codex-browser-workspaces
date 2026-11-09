---
name: Codex Browser Workspaces Popup
description: 紧凑深色的扩展状态面板，面向工作区连接与诊断操作。
colors:
  bg: "#171b22"
  surface: "#202630"
  line: "#343c49"
  text: "#edf2fa"
  muted: "#aab8c9"
  blue: "#7ab6ff"
  green: "#76d7ae"
  amber: "#f3c180"
typography:
  title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 650
    lineHeight: "19px"
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "11px"
    lineHeight: "15px"
  metric:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "19px"
    fontWeight: 650
    lineHeight: "23px"
rounded:
  surface: "8px"
  icon: "7px"
  compact: "6px"
  status: "20px"
spacing:
  panel: "16px"
  row: "10px"
  compact: "8px"
  inline: "6px"
components:
  refresh-button:
    backgroundColor: "transparent"
    textColor: "#c4d0dd"
    rounded: "{rounded.icon}"
    width: "30px"
    height: "30px"
  copy-button:
    backgroundColor: "transparent"
    textColor: "#d5e1ee"
    rounded: "{rounded.compact}"
    padding: "6px 8px"
  connection-connected:
    backgroundColor: "#1d3932"
    textColor: "{colors.green}"
    rounded: "{rounded.status}"
    padding: "5px 8px"
  connection-unavailable:
    backgroundColor: "#3b3028"
    textColor: "{colors.amber}"
    rounded: "{rounded.status}"
    padding: "5px 8px"
  metrics:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "12px 0"
  notice:
    backgroundColor: "#382e27"
    textColor: "#f4d1a4"
    rounded: "{rounded.compact}"
    padding: "9px 10px"
---

# Design System: Codex Browser Workspaces Popup

## Overview

**Creative North Star: "紧凑工作区状态面板"**

本规范记录当前扩展弹窗已经实现的视觉事实，范围仅限 `packages/extension/popup.html`、`popup.css`、`popup.js`、`status.js` 及其图标。视觉方向沿用用户提供的 ScriptCat 参考：紧凑深色、信息集中、操作明确。该表面属于 Operate 模式；它帮助用户确认连接状态、浏览工作区统计并复制诊断信息。

截图 `.artifacts/ui/connected.png`、`error.png`、`long-focus.png` 来自真实 Chrome 中的 fixture 页面，截图数字是示例数据。正式扩展尚未加载；统计来源的真实性仅经 Broker/worker 代码与 fixture 验证，不能将截图作为正式扩展运行验收。

**Key Characteristics:**

- 固定窄幅，三列等宽统计，工作区使用紧凑单列。
- 深色表面与细分隔线承担层次，蓝色承担操作与焦点提示。
- 连接状态同时使用文字和颜色；不可确认的旧数据有整板说明。
- 长标题保留单行布局，以鼠标和键盘可达浮层补全内容。

## Colors

配色取自 `popup.css` 的 CSS 自定义属性；上方 frontmatter 记录可复用基础值，组件专属的状态底色保留在组件定义中。

### Primary

- **blue**：按钮、统计说明和工作区标题的键盘焦点；与页面叠放图标的蓝色方向一致。

### Neutral

- **bg**：弹窗底色。
- **surface**：三列统计的共同表面。
- **line**：行分隔线、统计列分隔线和按钮描边。
- **text**：主标题、工作区名称和统计数字。
- **muted**：指标标签、页面统计、版本与更新时间。

连接正常使用 **green** 与深绿底色；断线、过期或错误使用 **amber** 与深棕底色。状态语义不能只依靠颜色，始终同时显示中文状态与必要说明。

## Typography

所有文字使用系统字体栈，不加载远程字体。数字使用等宽数字特性 `tabular-nums`，避免统计变化造成数字宽度跳动。

品牌标题采用 `title`；统计数字采用 `metric`。正文基准为 `body`，次要文字采用 `label`；指标标签单独使用较易扫读的 12px。工作区名称为 600 字重、19px 行高，章节标题为 650 字重。保留中文标签与英文产品名的实际大小写。

## Layout

弹窗宽度为 380px，以 `max-width:100vw` 约束；当前没有额外媒体查询或移动端布局。头部、主体和底部均沿同一 16px 水平边距对齐。头部在同一行排列图标、品牌、状态和刷新按钮，底部同一行排列版本/更新时间与复制按钮。

统计区采用三等列，列内水平留白 14px，中间以细线分隔。工作区列表最大高度为 256px，超出后内部纵向滚动；每行最小高度为 58px，行内图标与内容间距为 10px。标题单行省略，下方页面、租用、受保护计数保持一行。

完整标题浮层固定在视口内，左右边距均为 16px，最高为视口的一半，内容可换行并滚动；上下箭头可滚动浮层，Escape 可关闭。浮层定位为当前标题附近，并限制在弹窗可见区域内。

## Elevation & Depth

常态内容通过背景色、分隔线和间距区分，不给统计区或列表行增加卡片阴影。只有提示浮层使用 `0 4px 12px #0006` 阴影，强调其暂时覆盖内容的层级。当前未设置动画或过渡 token。

## Shapes

统计表面使用 `surface` 圆角，刷新按钮与工作区图标使用 `icon` 圆角，复制按钮、说明框和浮层使用 `compact` 圆角。连接状态为胶囊形，前置圆点为直径 6px 的圆形。图标是简洁线性页面与刷新符号；不引入独立插画。

## Components

- **刷新按钮**：方形描边图标按钮，悬停变为较亮深色底和白色图标；请求期间禁用并降低透明度，保留明确的无障碍名称。
- **复制按钮**：紧凑文字按钮，与刷新按钮共享悬停色。操作后使用“已复制”或“复制失败”反馈，并通过辅助技术播报。
- **连接状态**：圆点加中文标签。正常为绿色；不可用为琥珀色；初始连接状态为中性色。
- **统计区**：MCP 连接、活跃线程、工作区各占一列。MCP 连接说明可悬停或键盘聚焦展开；未知计数显示 `—`。
- **工作区行**：蓝色页面标记、名称、三个计数组成一行。完整标题浮层仅在名称实际被截断时显示。
- **异常说明**：断线、过期或错误时显示原因；存在历史观察值时，明确整板显示上次数据。不能只把个别计数标成过期。
- **空状态与底部信息**：区分暂无工作区、上次没有工作区和状态未知；版本与观察时间保留在底部。复制诊断信息不包含工作区标题、页面数据、错误原文或凭据。

## Do's and Don'ts

### Do:

- **Do** 保持共享边距与统计等分布局，让操作和状态易于扫读。
- **Do** 为所有可操作或可展开信息保留明显的键盘焦点。
- **Do** 同时用文字表达连接与数据新鲜度，保留未知值和错误的真实含义。
- **Do** 将正式安装、真实统计与浏览器验收状态交由项目进度和验收文档说明。

### Don't:

- **Don't** 将 fixture 截图中的示例数据描述为正式扩展当前状态。
- **Don't** 让长工作区标题撑宽弹窗或依靠只有鼠标能触发的说明。
- **Don't** 为本弹窗添加未实现的字体、动画、色阶或通用页面框架。
