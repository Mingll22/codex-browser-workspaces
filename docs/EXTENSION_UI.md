# 扩展状态面板

扩展图标以蓝色的叠放页面表示工作区；SVG 为源文件，manifest 指定 16、32、48、128 像素 PNG。弹窗使用系统字体、深色背景、分组表面和蓝色操作焦点，以紧凑列表呈现信息；视觉 token 与当前布局规范集中在 [DESIGN.md](../DESIGN.md)，设计工具扩展信息位于 [.impeccable/design.json](../.impeccable/design.json)。

弹窗打开时建立名为 `cbw:popup` 的运行时连接并请求扩展 worker 的 `cbw:get_status` 快照；弹窗关闭时 Chrome 断开该连接，worker 仅在有弹窗连接时推送页面统计。弹窗的刷新请求附带 `refresh: true`，并接收 `cbw:status` 推送，不做周期轮询。状态来源是 worker 与 broker 的真实快照：MCP 连接数、活跃线程数由 broker 提供；工作区的标题、页面数、租用数和受保护数由 worker 汇总。无观察值显示 `—`；断线或过期时保留上次数据并明确标注，不能解释成当前有效。状态错误仅将 `BROKER_STATUS_TIMEOUT`、`BROKER_STATUS_INVALID`、`STATUS_BROWSER_QUERY_FAILED` 和 `WORKSPACE_FAMILY_MIGRATION_REQUIRED` 映射为安全的中文原因，不显示任意错误原文。长工作区标题在悬停或键盘聚焦时通过浮层显示完整名称。面板不展示页面 URL，复制诊断信息也不包含标题、页面数据、错误文本或凭据。

工具栏角标在连接且连接数已知时显示实际 MCP 数，100 及以上显示 `99+`；连接数未知、断线、过期或错误显示 `!`，工具栏提示说明状态。弹窗和角标只是状态显示，安装与真实浏览器验收状态以项目进度及验收文档为准。
