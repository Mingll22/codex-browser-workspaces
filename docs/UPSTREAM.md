# 上游范围与补丁

固定官方 `chrome-devtools-mcp@1.11.0`（Apache-2.0），依赖由 package-lock.json 锁定。本项目的适配实现独立维护；同行资料与范围对比见 COMPARISON.md。构建复制到 `dist/upstream` 后应用 `scripts/patch-upstream.mjs`，不修改全局或项目 node_modules 中的官方原件；许可证随产物保留。

## 补丁

1. `McpResponse.createStructuredPage` 增加真实 `targetId = mcpPage.targetId`。这个内部字段必须随上游升级重新验证。
2. 每次内部 tools/call 携带 broker 生成的 `__cbwTargetIds`；缺失时拒绝。AsyncLocalStorage 将 scope 传到 page 查找与返回列表；不向 Codex 暴露此参数。
3. `McpContext.getPages/getPageById/getSelectedMcpPage` 只返回 scope 内目标；移除跨 scope 的 selected-page fallback 提示；非页面调用不读取其他选中页的 DevTools 数据。
4. context 刷新保留上游 mutex；后续业务操作采用每 pageId 的锁，不让慢页占住整个浏览器操作通道。禁止将这项补丁套到未审查的全局工具上。

5. 内部请求携带 `__cbwDeadline`，SDK v2 的 mcpReq.signal 传入 ToolHandler；在进入页面队列、取得锁及实际工具 handler 前检查。排队取消不提前释放前一操作的锁；Chrome 已接收的脚本不宣称可撤销。

构建核对具体替换锚点和版本，不匹配即失败。没有给未知上游版本加兼容猜测。

## 对 Codex 暴露的工具

自有 8 个：`open_page`、`list_pages`、`get_active_tab`、`move_tab_to_workspace`、`release_page`、`close_page`、`set_page_retention`、`reset_workspace`。

审查后转发 19 个：

```text
navigate_page take_snapshot take_screenshot click hover fill fill_form drag
press_key type_text wait_for evaluate_script handle_dialog emulate
list_network_requests get_network_request list_console_messages get_console_message
upload_file
```

所有转发工具要求当前真实组成员的显式 pageId，并在 Broker 原子领取/续租五分钟。元素、reqid 和 msgid 绑定稳定 target、成员代际、租约授予版本及上游连接代次；旧成员、旧授予和旧连接引用不能复用。list_pages 的 position 在完整真实组排序后再做租约过滤，不是操作 ID。返回上游文本/图片，移除未转换的 structuredContent 数字 ID 副本。

上游启动使用官方 `--categoryExtensions`，允许已授权的扩展管理页面通过上述页面工具访问；仍须使用 owned pageId。映射合并官方 `pages` 与 `extensionPages` 数组，并仅保留请求所属 targetId。两个字段均未出现表示发现尚未完成，沿既有有界等待继续查询；字段存在但不是数组则明确报契约错误。该选项不增加对外工具，扩展管理工具和 `serviceWorkerId` 继续不向 Codex 暴露，不修改官方 URL 校验。构建补丁关闭页面列表自动附带的扩展 worker 清单，因为页面所有权不授予 worker 访问权。

不暴露 `new_page/select_page`、`resize_page`、performance 全局 trace、Lighthouse、PWA、extension/worker 管理、WebMCP、heap 管理或未审查的新工具。`serviceWorkerId` 和直接 `filePath` 输出参数从公共 schema 删除；不能通过这些参数跳到其他 worker 或写出未适配的引用文件。上传由项目适配器在 WSL 中先转换 Windows 输入路径、校验 canonical path 所属 roots、打开并验证普通文件可读，然后用 wslpath 转换为 Windows Chrome 路径。支持 Windows 盘符路径、/mnt 路径和 WSL 原生路径；后者使用 WSL 的 Windows UNC 路径，不复制文件、不扩大 roots。文件选择成功不代表业务提交成功。

## 单独的只读 CDP 用途

`target-identity.ts` 仅调用 `Target.getTargetInfo` 读取真实 opener ID；不 attach、不截图、不导航、不执行脚本。这是为修正实测 Chrome tab opener 元数据问题而采用的映射接口。所有实际页面操作继续使用官方 MCP。

## 超时与不可用

上游请求有 25 秒边界并受总请求 deadline 限制。普通超时返回 `UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN`，取消返回 `REQUEST_CANCELLED`；两者保留共享上游进程和引用 epoch。实际 transport 关闭才使 epoch 失效并在下一次新请求重新连接；不重放点击、提交或导航。浏览器已经收到的操作可能继续执行，原页面锁保留到实际执行结束，其他页面仍可操作。

## 0.3.0：1.11.0 升级与弹窗恢复

- 官方 1.11.0 使用 MCP SDK v2 和 JSON Schema 2020-12；broker 使用 Ajv2020 校验，对外仍仅公开已审查的 19 个页面工具。内部 scope/deadline、源码文件读取和 worker 参数从公共 schema 移除。启动契约测试实际读取官方工具 schema 并编译，防止版本升级后服务无法启动。
- 新 stdio 工作目录注册后发送 roots/list_changed，显式声明相应 capability。失败的注册不会静默保留为已通知状态。
- 官方输入操作会用 AbortSignal 响应新出现的弹窗。适配补丁对所有带 pageId 的操作集中检查已有弹窗，evaluate_script 也不能绕过。handle_dialog 使用独立的同页恢复锁，仍通过相同所有权校验；普通页面操作仍串行，不释放未结束脚本的锁来假装完成。
- 已处理弹窗不再渲染为 Open dialog；普通脚本完成自动处理后清理弹窗缓存。
- navigate_page 默认 dismiss，保护未保存输入；只有显式 accept 才放弃草稿。取消 beforeunload 会中断导航等待，返回取消结果；真实导航错误返回 isError。Puppeteer goto 透传已有 LifecycleWatcher 的 signal 支持；WaitForHelper 不再等待已取消的导航。
- evaluate_script 自身触发的新弹窗仍遵循官方 dialogAction 契约，默认 accept；调用方可指定 dismiss 或 prompt 文本。不能把这个默认值与导航的草稿保护策略混淆。
- upload_file 返回 Files selected，不宣称服务器已经收到文件。不存在、不可读、非普通文件和 roots 范围外文件明确失败；保持 Windows 浏览器路径完整，不交给 Linux path.resolve 拼接。

附加补丁均由 scripts/patch-upstream.mjs 在构建副本内应用，逐项检查唯一锚点。正式运行的 node_modules 原件不做临时手工修改。


## 0.3.1：最小化捕获

`scripts/upstream-capture.mjs` 在官方截图 handler 的同一 CDP session 查询 `Browser.getWindowForTarget`，仅最小化时临时开启 1x1 screencast 维持产帧。仍通过官方 page/element.screenshot 生成图片；async disposer 在成功、失败后被等待，取消通过同一个 stop Promise 清理。没有窗口恢复、bringToFront、启动参数修改或未知错误降级。

构建修改的上游文件保留其原版权与 Apache-2.0 声明，并标明本项目作过修改。自有代码同样采用 Apache-2.0。见根目录 LICENSE、NOTICE。

## 开发与管理脚本边界

正式 Broker 只透传上述页面 allowlist，不开放 extension/worker 管理。源码中的 extension-test-client.mjs 是显式安装/回滚的管理辅助：通过固定官方 MCP 与显式 target 元数据适配查找经验证的 anchor target 与固定项目扩展 ID，仅向该 worker 执行精确状态收据操作；不把管理工具暴露给模型页面工具。0.4 升级先导出全部真实组成员，纯计划器将历史 spawn 归属归根；多真实组冲突停止，不按同名组认领。加载和回滚都重新比较完整 tab/target/group/window 收据。

管理/测试入口的 upstream-target-metadata.mjs 只将官方 page 对象的 targetId 加入返回元数据；同 URL 按 page.id 精确映射，不修改工具 handler、不授予页面权限。固定 1.11.0 与三个精确结构锚点在构建和入口启动时校验。它只由显式管理/fixture客户端 preload，正式 Broker 仍使用 scope 限定的 dist/upstream；未修改 node_modules。
