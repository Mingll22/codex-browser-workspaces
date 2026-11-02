# Codex Browser Workspaces

基于官方 Chrome DevTools MCP，为 Codex CLI 提供按真实线程归属管理的 Chrome 标签组。

[English](README.md) · [安装](docs/INSTALL.md) · [架构](docs/ARCHITECTURE.md) · [同行功能对比](docs/COMPARISON.md)

多个 Codex 对话复用同一个已经登录的 Chrome profile，每个线程拥有一个独立彩色标签组。适配器按调用元数据校验真实线程身份；普通用户标签不会因 URL 相同或移入同名分组而被认领。

当前为 **0.3.1 早期版本**，已验证环境是 **WSL 中的 Codex CLI + Windows Chrome**。它是独立社区项目，不是 OpenAI 或 Google 官方产品。

主要能力包括页面 slot 复用、页面及元素引用归属、真实 opener 弹窗归属、移出组撤销权限、截图排队和原标签恢复，以及真实最小化窗口截图。取消、超时和断线保留真实错误，不自动重放浏览器操作。

它提供工具层的页面归属限制；Cookie、站点存储及账号仍然共享，不构成账号隔离或操作系统安全沙箱。

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

0.3.1 基线包含 67 项自动化检查，以及真实 Windows Chrome 的最小化截图与取消恢复验证。验证范围与限制见[验收记录](docs/ACCEPTANCE.md)。官方后端固定为 1.11.0，本地补丁见[UPSTREAM.md](docs/UPSTREAM.md)。

## 许可

Apache-2.0，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。官方 Chrome MCP 及其他依赖保留原有许可声明。
