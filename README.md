# Codex Browser Workspaces

Thread-owned Chrome tab groups for Codex CLI, built on the official Chrome DevTools MCP.

[中文说明](README.zh-CN.md) · [Install](docs/INSTALL.md) · [Architecture](docs/ARCHITECTURE.md) · [Related projects](docs/COMPARISON.md)

Run several Codex conversations against one already-running, logged-in Chrome profile. Each real Codex thread owns a colored tab group and can operate only on its registered pages through this MCP adapter. Your ordinary tabs remain outside its ownership.

**Status:** early development, adapter source version 0.3.3 with extension 0.3.1. The validated environment is **Codex CLI in WSL + Windows Chrome**. This is an independent community project, not an official OpenAI or Google product.

## Why this exists

Page routing identifies a target; it does not establish which conversation owns it. This adapter binds each call to Codex's thread metadata, checks page ownership, and coordinates the shared window without asking the model to choose a thread ID.

- One stable colored tab group per thread, named `[Project]Thread name`, in the shared Chrome window.
- Named page slots such as `main` and `reference`, with explicit close and retention controls.
- Automatic cleanup after a registered thread's MCP process exits; idle and temporarily disconnected live controllers keep their pages.
- Page, element, console and network references scoped to their owning page and connection generation.
- Ordinary tabs are never adopted because their URL or group title happens to match.
- Owned popups inherit ownership through their actual CDP opener; dragging a tab out revokes access.
- Screenshots restore the previous active tab and do not bring Chrome to the foreground. Minimized-window capture is supported in the validated Windows environment.
- Cancellation, deadlines and disconnects return explicit errors; browser mutations are not automatically replayed.
- Browser/extension session changes require explicit workspace reset rather than guessing old ownership.

This is **tool-level page ownership**, not account isolation or an OS security sandbox. Cookies, storage and website accounts remain shared. Programs with independent shell/CDP access are outside this boundary.

## Requirements and setup

- Node.js 22.22 or newer in WSL; Windows Chrome with a reachable loopback CDP endpoint.
- A Codex CLI build that supplies matching `_meta.threadId` and `_meta["x-codex-turn-metadata"].thread_id` values on tool calls. Other MCP clients are not currently supported.
- Ability to load a local Manifest V3 extension into that Chrome profile.

```bash
git clone https://github.com/Mingll22/codex-browser-workspaces.git
cd codex-browser-workspaces
npm ci --ignore-scripts
npm run build
npm test
```

Continue with [installation](docs/INSTALL.md) to install the broker, pair the Windows extension and register the MCP entry. Building alone does not connect the browser or edit your Codex configuration. No npm registry publication or Chrome Web Store listing is currently provided.

The adapter attaches to a **debugging-enabled Chrome profile**; it cannot enable remote debugging on an arbitrary running personal profile. Follow the [official connection guide](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md) when preparing Chrome, then reuse that profile's login state. Do not expose the debugging port to your network.

## Tools

Workspace tools: `open_page`, `list_pages`, `close_page`, `set_page_retention`, `reset_workspace`.

An allowlist forwards 19 official page tools for navigation, snapshots, screenshots, interaction, dialogs, JavaScript, console, network and file selection. Each requires an owned `pageId`. Browser-wide or unreviewed tools are not exposed. See [the upstream contract](docs/UPSTREAM.md).

## Validation and limitations

Automated checks cover project/thread labels, ownership, lifecycle, cancellation and portable archive installation. Real browser evidence distinguishes actual Codex host threads from synthetic protocol fixtures. See [acceptance](docs/ACCEPTANCE.md) for dated results, minimized-screenshot evidence and untested boundaries.

The official backend is pinned to `chrome-devtools-mcp@1.11.0`. Build-time patches are checked against exact source anchors and fail on an unreviewed version. Native Linux/macOS Chrome, generic MCP clients and recovery of arbitrary page state after a complete browser restart are not claimed.

## Development

```bash
npm run build
npm test
node scripts/prepare-dev.mjs
```

The last command generates an isolated development configuration under ignored `.artifacts/`. See [CONTRIBUTING.md](CONTRIBUTING.md) before running browser integration tests: worktrees do not isolate Chrome, ports or real user sessions.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The official backend and other dependencies retain their own license notices. Upstream modifications are documented in [docs/UPSTREAM.md](docs/UPSTREAM.md).
