# Codex Browser Workspaces

Root-family Chrome tab groups with caller page leases for Codex CLI, built on the official Chrome DevTools MCP.

[中文说明](README.zh-CN.md) · [Install](docs/INSTALL.md) · [Architecture](docs/ARCHITECTURE.md) · [Related projects](docs/COMPARISON.md)

Run several Codex conversations against one already-running, logged-in Chrome profile. A root conversation and all descendant agents share one colored tab group, while each caller acquires its own page leases. Independent root conversations keep separate groups. User tabs can be explicitly moved into the group without losing their current state; imported pages remain protected from close and automatic reuse.

**Status:** adapter and extension **0.4.0 development candidate, not deployed**. Root-family/lease Chrome acceptance has not run. Earlier validation covers **Codex CLI in WSL + Windows Chrome** at the versions recorded in [acceptance](docs/ACCEPTANCE.md). This is an independent community project, not an official OpenAI or Google product.

## Why this exists

Page routing identifies a target; it does not establish which conversation owns it. This adapter binds each call to Codex's thread metadata, checks page ownership, and coordinates the shared window without asking the model to choose a thread ID.

- One stable colored group per root conversation and its descendant agents, named `[Project]Root thread name`. Family resolution follows real Codex spawn edges; forks remain independent roots.
- Current group members listed in Chrome order, filtered to available pages and this caller's leases; listing never claims a page.
- Five-minute idle page leases, explicit `release_page`, and fresh versioned references after release or expiry.
- Named managed slots such as `main` and `reference`; busy slots cannot be taken, and external pages never become an implicit slot.
- Family-wide cleanup waits for every known controller to leave and its registered process to exit; idle and temporarily disconnected live processes keep pages.
- Page, element, console and network references scoped to their owning page and connection generation.
- Active-tab metadata discovery followed by an explicit move of the original tab, preserving page state without reload or cloning. External/manual transfers stay `canClose=false`.
- Real Chrome group membership is authoritative. Manual moves and closes are accepted; missing pages are never revived. Popups use their actual CDP opener.
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

The extension toolbar shows the actual MCP connection count. Clicking its icon opens a compact status panel with connection, identified-thread and workspace summaries; opening it never renews a lease. See [the popup contract](docs/EXTENSION_UI.md) and [visual system](DESIGN.md).

## Tools

Workspace tools: `open_page`, `list_pages`, `get_active_tab`, `move_tab_to_workspace`, `release_page`, `close_page`, `set_page_retention`, `reset_workspace`.

For a newly requested group position, list once and resolve its one-based `position`, then continue with the returned `pageId`. Positions follow the full current group before lease filtering and can have gaps. After a lease/reference expires, list again and read fresh page state. `get_active_tab` returns metadata only; content access starts after the exact tab is explicitly moved into the family and leased.

An allowlist forwards 19 official page tools for navigation, snapshots, screenshots, interaction, dialogs, JavaScript, console, network and file selection. Each requires an owned `pageId`. Browser-wide or unreviewed tools are not exposed. See [the upstream contract](docs/UPSTREAM.md).

## Validation and limitations

Automated checks cover the candidate identity, lease and membership contracts with disposable fixtures. Real child/grandchild metadata and read-only SQLite resolution have also been checked; those calls used the old installed broker and do not prove new-model grouping. Root-family/lease Chrome acceptance remains unrun: the temporary official-backend connection was rejected by canonical-root validation of Windows paths, and that protection was not bypassed. See [acceptance](docs/ACCEPTANCE.md) for dated results, the installation blocker and earlier browser evidence.

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
