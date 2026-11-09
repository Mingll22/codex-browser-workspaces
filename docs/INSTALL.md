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

Reconnect the MCP client. Open a disposable page, list only that thread's pages, read it, take a screenshot, and close it. Confirm only current real group members are visible under the caller lease, external members have canClose=false, and Chrome did not take OS focus. Do not use `reset_workspace` to adopt an unrelated existing group.

## Leases and family cleanup

One real spawn family shares one group; each actual caller owns its own page leases. A list does not claim or renew. Page reads/operations grant five minutes; expired grants require a newly listed handle and fresh page state. Executing or UNKNOWN calls remain occupied past expiry. `release_page` releases an idle known lease, without closing the page or making external work disposable. There is no perpetual heartbeat.

The existing `closedThreadGraceMs` default remains 30000. Cleanup considers every registered family actor separately, including live disconnected processes. One child ending cannot clear a live family. Cleanup also skips retained, protected, leased, executing and UNKNOWN pages. Optional `detachedTtlMs` remains null. Historical groups without process evidence are preserved. Reconnect clients after upgrade to register their actual processes and refresh the tool schemas.

## Source upgrades

Use the canonical source checkout at `/home/mingll/data/codex-browser-workspaces` for this installation. The former `codex-browser-workspaces-thread-cleanup` linked worktree is retired after its source/evidence integration; it is not a second installation. Build output is `dist`, the formal WSL installation remains `~/.local/share/codex-browser-workspaces`, runtime/pairing data remains `~/.local/state/codex-browser-workspaces`, and the Windows extension remains `%LOCALAPPDATA%\CodexBrowserWorkspaces\extension`. Do not delete these distinct runtime roles as duplicate source. Build output includes dist/build-info.json with the source commit, dirty flag, versions and build time. Installer installation.json preserves that build receipt even when installed from an extracted archive, alongside its source location. `--stage-only` creates a reviewable candidate without replacing the formal directory or service.

0.4 requires a matching page model (`pageModelVersion=2` in the bridge hello), plus the toolbar popup assets and clipboardWrite permission for user-requested diagnostic copy. Independent component version numbers alone are not a compatibility check. Old loaded extensions are rejected with `EXTENSION_UPGRADE_REQUIRED`; legacy state is rejected with `WORKSPACE_FAMILY_MIGRATION_REQUIRED` until an exact migration is staged. This keeps old per-thread groups from silently becoming independent family groups.

An admin must coordinate a quiet interval with all browser callers. Use an exact current owned **target ID**, not the final component of the versioned public pageId. The old pageId format places target last; the 0.4 handle also contains membership and grant versions and must be treated as opaque. Preserve all original files and state receipts. Do not stop or restart Chrome.

```bash
node scripts/snapshot-family-state.mjs OWNED_TARGET_ID .artifacts/family-before.json
node scripts/plan-family-migration.mjs --input .artifacts/family-before.json --output .artifacts/family-plan.json
node scripts/upgrade.mjs --anchor OWNED_TARGET_ID \
  --family-plan .artifacts/family-plan.json \
  --extension-dir /mnt/c/Users/YOUR_WINDOWS_USER/AppData/Local/CodexBrowserWorkspaces/extension
```

The first two commands only inspect the exact project worker and write local files. The planner uses the broker's `CODEX_HOME` database, preserving the generation and exact group IDs. A family with multiple real groups returns their exact IDs for resolution; it never merges by title, moves real pages, closes them or changes login state. Empty/closed history stays empty. The stage step rechecks all actual group members immediately before applying the plan; added/moved/replaced objects require a fresh snapshot and plan.

The upgrade command builds/tests, stages the installation, requires an idle broker, retains both artifact and extension backups, stops only the broker, stages model state, starts the new listener and reloads only this project extension. It verifies versions, generation and complete live receipts. It saves the original complete extension state as a separate rollback plan; even an uncertain staging result attempts restoration under the same exact receipt checks. No window relocation is performed. The script-level plan/rollback fixture is tested; the formal 0.4 transition has not been executed in the current code task.

`--adapter-only` requires the exact extension version already loaded and is unsuitable for the 0.3 → 0.4 model transition. If initial extension loading requires human Chrome UI, use the normal unpacked-extension steps. A Windows/WSL path/root rejection from the official install tool is a concrete capability boundary; do not relax roots or restart the shared browser to bypass it.

For this managed installation, code prepares the artifact/configuration diffs; admin applies formal service, extension and Profile changes. The admin report records the actual source commit, candidate paths and loading/acceptance sequence.

## Rollback

The installation and upgrade receipts identify retained artifact backups. `scripts/rollback-install.mjs INSTALLED_DIRECTORY` restores the prior WSL installation files without touching state; coordinate service stop/start and any matching Windows extension rollback separately. After multiple upgrades, the immediate previous backup may be an intermediate candidate: verify the intended version before restoring it.

Do not replace current workspace ledgers, pairing configuration, cookies or profile data with an old snapshot. Changing installed files does not recover arbitrary browser state after a full browser restart.

Before browser work resumes, a failed upgrade can restore the saved original extension mapping with exact unchanged receipts and the corresponding artifact backups. After new page activity or group movement, do not blindly replay an old snapshot: take a fresh snapshot and reconcile the exact objects. UNKNOWN page executions require observed terminal evidence before an admin clears that specific lease record; neither timeout nor five idle minutes proves termination.
