# Install, upgrade and rollback

The supported setup is Codex CLI in WSL and an existing Windows Chrome **debugging-enabled profile**. Node.js 22.22+ is required. This guide does not start Chrome, copy login state, modify a firewall or automatically edit Codex configuration.

## 1. Check prerequisites

The Windows Chrome CDP endpoint must be reachable from WSL, normally at `http://127.0.0.1:9222/json/version`. The extension must also be able to reach the WSL broker at `ws://127.0.0.1:19227`. Reachability in one direction does not prove the other.

Follow the [official Chrome connection instructions](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md) if Chrome is not already debugging-enabled. Modern Chrome restricts remote debugging on its default personal profile. Keep the endpoint on loopback; this adapter does not provision a new browser or reuse cookies by copying them.

Codex must supply both thread metadata fields described in [ARCHITECTURE.md](ARCHITECTURE.md). If it does not, the adapter returns `THREAD_IDENTITY_UNAVAILABLE`; generic MCP clients cannot simply supply a tool argument instead.

## 2. Build and install the files

From a source checkout:

```bash
npm ci --ignore-scripts
npm run build
npm test
node scripts/install.mjs
```

The installer copies the adapter to `$XDG_DATA_HOME/codex-browser-workspaces` (default `~/.local/share/codex-browser-workspaces`) and creates its configuration in the chosen state directory (default `~/.local/state/codex-browser-workspaces`). It preserves an existing matching configuration and retains a previous installation backup. Use `--destination`, `--state-dir` and `--port` when choosing different paths. The development build's pairing token is replaced with this installation's pairing configuration.

A locally built prebuilt archive can also be installed:

```bash
node scripts/package.mjs
# Extract the emitted archive into a temporary directory, enter it, then:
node scripts/install.mjs
```

The prebuilt archive includes dependencies, patched upstream output, public documentation and licenses. It excludes pairing configuration and personal handoff records. It supports file installation and rollback; **source-based upgrades require the full source checkout**, not this archive. No GitHub binary release or npm package is implied by these commands.

## 3. Load the Windows extension

Use the **installed** `dist/extension`, not the development copy, so its pairing configuration matches the installed broker. For default paths, print the Windows source paths in WSL:

```bash
wslpath -w "$HOME/.local/share/codex-browser-workspaces/dist/extension"
wslpath -w "$PWD/scripts/deploy-extension.ps1"
```

In Windows PowerShell, run the printed script path with the printed extension path as `-Source`. Example, replacing the distro and Linux user placeholders:

```powershell
& '\\wsl.localhost\YOUR_DISTRO\home\YOUR_USER\codex-browser-workspaces\scripts\deploy-extension.ps1' `
  -Source '\\wsl.localhost\YOUR_DISTRO\home\YOUR_USER\.local\share\codex-browser-workspaces\dist\extension'
```

The script manages only `%LOCALAPPDATA%\CodexBrowserWorkspaces\extension`, retaining the previous extension directory on update. In the intended Chrome profile, open `chrome://extensions`, enable Developer mode and load that Windows directory as an unpacked extension. Do not load a second copy into another profile for the same broker.

## 4. Start the broker

For a first installation using systemd user services and default paths:

```bash
systemctl --user link "$HOME/.local/share/codex-browser-workspaces/codex-browser-workspaces.service"
systemctl --user daemon-reload
systemctl --user enable --now codex-browser-workspaces.service
curl -fsS http://127.0.0.1:19227/health
```

Expected health has `connected: true` after the extension connects. `adapter`, `extension` and `upstream` report runtime versions. A healthy broker alone does not prove screenshot or page ownership behavior. Without systemd, start the installed broker in a managed terminal with the configuration path as its sole argument.

For an existing installation, preserve its service and any Chrome lifecycle drop-ins. Use the upgrade procedure below rather than replacing shared configuration.

## 5. Register Codex MCP

The installer emits `admin-mcp.toml` inside its installation directory, with actual absolute paths. Copy that stanza into your intended Codex configuration, replacing the existing unrestricted Chrome entry rather than exposing both. For example:

```toml
[mcp_servers.chrome-devtools]
command = "/absolute/path/to/node"
args = ["/absolute/install/dist/adapter/src/stdio.js", "/absolute/state/config.json"]
startup_timeout_sec = 15
tool_timeout_sec = 90
```

Use the generated paths; do not paste the placeholders literally. Project-specific profile allowlists, if any, must permit the intended workspace tools and forwarded page tools. The optional `render-admin-diff.py` is a maintainer helper for a particular multi-profile layout, not a required installer step.

Reconnect the MCP client. Open a disposable page, list only that thread's pages, read it, take a screenshot, and close it. Confirm ordinary tabs were not adopted and Chrome did not take OS focus. Do not use `reset_workspace` to adopt an unrelated existing group.

## Automatic group cleanup

The broker's configuration defaults to `closedThreadGraceMs: 30000`. When a thread's registered stdio process exits, its non-retained pages close after the grace period plus up to five seconds for exit detection. Closing the last page removes the Chrome group unless it also contains retained or ordinary user tabs. A thread that is simply idle or temporarily disconnected keeps its pages while its stdio process is alive. A reconnect cancels pending cleanup.

After upgrading from 0.3.1, reconnect already-running MCP clients once so their next browser calls register a process lifetime. New stdio processes do this automatically. Older groups with no registered lifetime are not bulk-collected. Set `closedThreadGraceMs` to `null` to opt out; `detachedTtlMs` is a separate optional policy and remains `null` by default. Details and uncertain-close behavior are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Source upgrades

Use a reviewed source checkout with its dependencies installed. Close or finish active tool requests first. Supply a current **owned target ID** (the last component of a returned pageId) and the WSL path to the installed Windows extension directory:

```bash
node scripts/upgrade.mjs \
  --anchor OWNED_TARGET_ID \
  --extension-dir /mnt/c/Users/YOUR_WINDOWS_USER/AppData/Local/CodexBrowserWorkspaces/extension
```

The script builds/tests, stages artifacts, requires an idle broker, saves exact live-target receipts, updates the adapter/extension and verifies generation and ownership after reconnect. It stops only the broker, not Chrome. `UPGRADE_BUSY` is a request to wait for in-flight work to finish, not to bypass the protection. Do not run acceptance/browser calls concurrently with this upgrade.

Use `--adapter-only` only when the loaded extension version and code already match the source extension; it avoids extension reload. The adapter and extension have independent runtime versions (for example, adapter 0.3.2 with extension 0.3.1). Non-default installations also need their explicit `--destination` and `--state-dir`.

## Rollback

The installation and upgrade receipts identify retained artifact backups. `scripts/rollback-install.mjs INSTALLED_DIRECTORY` restores the prior WSL installation files without touching state; coordinate service stop/start and any matching Windows extension rollback separately. After multiple upgrades, the immediate previous backup may be an intermediate candidate: verify the intended version before restoring it.

Do not replace current workspace ledgers, pairing configuration, cookies or profile data with an old snapshot. Changing installed files does not recover arbitrary browser state after a full browser restart.
