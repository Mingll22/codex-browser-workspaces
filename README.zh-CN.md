# Codex Browser Workspaces

基于官方 Chrome DevTools MCP，为 Codex CLI 提供根线程家族共组与调用者页面租约。

[English](README.md) · [安装](docs/INSTALL.md) · [架构](docs/ARCHITECTURE.md) · [同行功能对比](docs/COMPARISON.md)

多个 Codex 对话复用同一个已经登录的 Chrome profile。一个根线程及其所有层级子代理共享一个以 `[项目名]根线程名` 命名的彩色标签组，各调用者通过页面租约协调使用；独立根线程和 fork 分组隔离。适配器从真实调用元数据与 Codex 父子边确认归属，不接受模型填写的线程身份。

当前适配器与扩展为 **0.4.0 开发候选，尚未部署**。新模型的真实 Chrome 验收尚未执行；历史验证环境为 **WSL 中的 Codex CLI + Windows Chrome**，具体适用版本见[验收记录](docs/ACCEPTANCE.md)。它是独立社区项目，不是 OpenAI 或 Google 官方产品。

候选契约包括：

- 按真实 Chrome 组成员顺序列页，只展示可用页与当前调用者持有的页；列表不抢占、不续租。
- 页面操作取得或续期五分钟空闲租约；工作完成用 `release_page` 释放。租约更替后必须重新取引用和页面状态。
- `open_page` 只复用明确的托管 slot；忙碌 slot 不可抢占，外部页不会成为隐式 `main`。
- `get_active_tab` 只发现当前标签元数据；核对任务后用 `move_tab_to_workspace` 搬入原 tab，保留页面状态，不克隆、不重载，也不要求它仍是活动页。
- 手工移入及显式搬入的页面均受保护，`canClose=false`，不参与自动关闭或 slot 复用；不可借 JavaScript 或其他路径绕过。
- 用户手工移动、排序和关闭以当前 Chrome 状态为准，不按历史恢复页面。
- 自动清理等待整个根家族的已知调用者离开且注册进程退出，再应用默认约 30 秒宽限；仍有子代理活跃时不清理。
- 页面及元素引用包含会话、成员关系和租约版本；截图维持原标签恢复机制，取消或超时保留真实结果，不自动重放浏览器操作。

用户新指定“第 N 个页面”时，先从新列表一次性解析其 `position`，之后使用返回的 `pageId`。位置按完整真实分组从 1 开始计算，租约过滤后可以不连续。

它提供工具层的页面归属限制；Cookie、站点存储及账号仍然共享，不构成账号隔离或操作系统安全沙箱。

工具栏使用蓝色叠页图标，角标显示真实 MCP 连接数；点击可查看连接、已识别线程、工作区与租约摘要，并刷新或复制不含凭据的诊断信息。弹窗不领取或续租页面。参见[面板说明](docs/EXTENSION_UI.md)与[视觉规范](DESIGN.md)。

## 开始使用

需要 Node.js 22.22+、满足线程元数据契约的 Codex CLI，以及可从 WSL 访问 CDP 的 Windows Chrome profile。当前不宣称支持任意 MCP 客户端或所有操作系统。

```bash
git clone https://github.com/Mingll22/codex-browser-workspaces.git
cd codex-browser-workspaces
npm ci --ignore-scripts
npm run build
npm test
```

接着按[安装说明](docs/INSTALL.md)加载扩展、启动 broker 并登记 MCP。构建不会自动修改全局配置。Chrome 必须事先启用远程调试；现代 Chrome 对默认个人 profile 的远程调试有限制，因此不能理解为可接管任意已经打开的浏览器。请参阅[官方连接文档](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md)。

候选自动化检查使用可丢弃 fixture 验证身份、租约与成员契约；真实子/孙线程的调用元数据和 SQLite 多级归根也已只读验证。这些 MCP 调用仍经过旧正式 broker，不能证明新模型已经共组。临时官方后端连接因 Windows 路径的 canonical roots 校验被拒绝，未绕过该保护，新模型真实 Chrome 验收尚未执行。完整结果、安装阻碍与历史浏览器证据见[验收记录](docs/ACCEPTANCE.md)。官方后端固定为 1.11.0，本地补丁见[UPSTREAM.md](docs/UPSTREAM.md)。

## 许可

Apache-2.0，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。官方 Chrome MCP 及其他依赖保留原有许可声明。
