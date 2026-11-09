# Validation and compatibility

## 0.4.0 root-family and page-lease candidate, 2026-11-09

The source and artifacts are a **candidate**, not the currently loaded installation. `npm run build && npm test` passed **146/146** local checks. These checks use disposable Chrome API/bridge fixtures, temporary read-only SQLite databases and a controlled clock; the five-minute boundary was simulated, not observed for five wall-clock minutes. Script-level checks include exact-state forward/rollback restoration and a state write followed by a simulated lost response. The prior version's browser evidence below remains historical.

Real Codex metadata was checked for a root, child and grandchild: each MCP call used a different actual caller ID, and two real `thread_spawn_edges` led to the same root. The candidate directory resolved the grandchild with three synchronous queries, cached all three mappings and retained one read-only connection. Formal `list_pages` calls by those agents returned zero pages through installed adapter **0.3.3 / extension 0.3.1**. This proves actual identity and candidate resolution, not 0.4 grouping or leases in Chrome. Local detailed evidence stays in ignored `.artifacts/root-family-identity-evidence.json`.

A temporary candidate extension with a distinct key and isolated broker configuration was prepared. The official installation tool rejected the Windows path because WSL canonical-root validation treated it as a relative path. No root allowlist, formal extension, service, login profile or Chrome process was changed to bypass that refusal. The temporary extension was never loaded. The candidate broker/stdio tool-list check exposes the eight workspace tools plus nineteen official page tools; it is a protocol/schema check, not browser operation acceptance.

| Acceptance behavior | Current evidence | Required after admin loading |
| --- | --- | --- |
| Manual drag-in, drag-out and drag-back | Extension membership fixture; fresh membership invalidates old handle | Use disposable original tabs and exact group receipts; confirm content appears/disappears without registration |
| A → independent B transfer | Fixture revocation, close protection and global target execution occupancy | Manually move the owned test tab; A old ID fails, B lists original target as protected |
| Active discovery independent of move | Fixture recent normal window, active vs highlighted, later selection change | Discover test tab, activate another self-owned test tab, move the original reference |
| Empty family imports original tab | Fixture no new tab/refresh, active=true without focus API | Verify unchanged target/document state, no blank side product and stable OS foreground |
| Position/order/lease gaps | Full-group order fixture, broker filter and exact position rejection | Reorder four test tabs, lease position 2 elsewhere, assert positions 1/3/4 |
| Root/child/grandchild and independent family | Real identity/SQLite chain + family bridge fixture | Actual tool calls from all levels use one exact group; independent root uses a different group |
| Sibling race and direct old-ID denial | Atomic lease and concurrent Workspaces fixture | Race siblings against one available test target: one grant, other list hidden/direct call denied |
| List vs operation renewal and old UID | Controlled five-minute boundary + UID/grant checks | Real claim/release/isolation; controlled-clock evidence remains separate from any wall-clock observation |
| In-flight expiry, timeout/cancel/UNKNOWN | Fixture expiry cannot steal running/unknown target, including cross-family movement | Use bounded test actions only; inspect actual result, never replay uncertain action |
| External close protection | Extension explicit close, broker cleanup, retention independence fixtures | Import a test tab; explicit close and cleanup refuse, then only simulated user action closes exact fixture |
| Single/main/last/group closure | Fixture missing-page cleanup and no resurrection; target replacement checks | Close exact test objects in Chrome, then list/reconnect/old-ID calls create nothing |
| One child ends | Family actor fixtures, including child-first without root lifetime evidence | End one actual child while another family actor uses a test tab; preserve other leases/protected pages |
| Read-only DB/cache/failure | Native SQLite read-only, deep-chain, no-held-transaction/cache/failure tests | Confirm broker CODEX_HOME and schema match before loading; never modify Codex DB |
| Existing regressions | Slot/same URL, mapping discovery wait, extension-page schema, reconnect, refs, capture/cancel/minimized helpers | Repeat scoped ordinary/extension-page mapping, background and minimized capture without restoring Chrome |

The new-model Chrome rows remain **NOT RUN** until admin loads the matching extension and broker. All browser fixtures must create their own identifiable objects and clean only exact created receipts; adapter close is intentionally unavailable for protected external tabs, so their final removal is a test-owned simulated user action. Do not run historical synthetic-ID harnesses against a 0.4 broker or substitute guessed identities. `tests/live-*.mjs` marked historical are retained only to interpret older evidence.

## Extension icon and popup acceptance

The 0.4 candidate includes 16/32/48/128px geometric grouped-page icons and a toolbar badge showing actual registered MCP connections (99+ above 99; ! for unknown/error/disconnected). The popup uses authenticated broker counts and current group metadata; it never grants or renews a page lease. It scans group metadata only when the popup is open or explicitly requested, while badge counters reuse the existing bridge heartbeat. The additional `clipboardWrite` permission is used only by the user's copy-diagnostics action; diagnostics omit titles, page data and credentials.

The popup was rendered through the official MCP in real Chrome at 380 CSS pixels in connected, disconnected, empty, timeout/error and long-title states, using prominently labelled sample data. Screenshots, keyboard-focused full-name tooltip, refresh-enabled recovery and successful copy feedback were inspected. No horizontal overflow was measured. The independent review's stale-data label and keyboard-title findings were both fixed and rescored resolved; its final `ship` disposition covers the fixture UI only. Temporary viewport overrides were restored and both exact own preview targets were queried absent after closing. Evidence is local under ignored `.artifacts/ui/`.

The installed-extension popup/toolbar and actual live broker-to-popup numbers still require admin loading. Their source/bridge/DOM fixtures passed; this is separate from a live installed-extension acceptance.

## Historical deployed-version evidence

This document distinguishes automated checks, real browser fixtures and real Codex calls. The evidence below was recorded on 2026-11-03 for adapter/extension 0.3.1 with official Chrome DevTools MCP 1.11.0.

## Project-aware labels and diagnostics, 2026-11-05

Adapter 0.3.3 adds `[Project]Thread name` group labels and cleanup registration diagnostics, using the existing extension 0.3.1 and official MCP 1.11.0. Eighty automated checks passed, including real temporary SQLite metadata, project-root boundary matching, linked-worktree resolution, Unicode truncation and prefix deduplication. New page opens avoid one preliminary title bridge request; this is a verified request-path reduction, not an end-to-end latency benchmark.

The installed adapter passed six real lifecycle checks in `tests/live-thread-cleanup.mjs`, including native Chrome group-title readback for three actual ephemeral Codex threads. Seven real group-reuse checks also passed. A separate check imported the actual backed-up 0.3.2 RPC client and confirmed it remained registered on the 0.3.3 broker without a false reconnect recommendation. The current 0.3.1 client correctly reported missing process registration and a reconnect recommendation.

The admin display migration updated currently owned group titles after verifying the exact extension generation and tab/target/group/window receipts. Page receipts, group colors and collapsed state were preserved. Metadata is refreshed on the next owned browser operation after the two-second cache expires; this release does not subscribe to idle thread/project rename events.

## Closed-thread cleanup, 2026-11-05

Adapter 0.3.2 was loaded with the existing extension 0.3.1 and official MCP 1.11.0. The broker-only upgrade preserved the extension generation and all three previously registered live page receipts; Chrome and its profile were not restarted. The source checkout built successfully and 75 automated checks passed. The npm entry process hung in WSL's kernel network-interface enumeration; the equivalent TypeScript/build scripts and `node --test tests/*.test.mjs` ran directly and passed.

`tests/live-thread-cleanup.mjs` completed with exit code 0 against the installed adapter and real Chrome. Three actual Codex 0.166.0 app-server threads created their own MCP subprocesses. After 37 seconds without browser calls, their pages still existed. Unsubscribing/unloading two threads terminated their subprocesses; the disposable thread's page and group disappeared after the default cleanup grace. The other loaded thread and a retained page survived. A separate synthetic protocol fixture proved that disconnecting a still-live controller preserves the exact page and that reconnect resumes it. Five lifecycle assertions passed; fixture pages were explicitly removed and their absence checked.

No model turn was started in that harness. The experimental `mcpServer/tool/call` API injected the actual thread ID; the fixture supplied the matching turn-metadata envelope. This proves real host lifecycle, broker behavior and browser cleanup, rather than revalidating model-generated metadata. Seven additional real group-reuse assertions passed, including foreign-tab protection, revocation after manual movement, and preserving a group containing an ordinary user tab. The earlier minimized-screenshot evidence below was not repeated for this backend-only change.

Already-running 0.3.1 stdio clients require a reconnect before registering process-exit cleanup. Historical workspaces without process evidence remain untouched. Client-side delay before actual thread unload is additional to the broker's 30-second grace. Retention, foreign tabs, uncertain-close dialogs and browser-generation changes can legitimately leave a group visible; the adapter does not force-close them.

| Scope | Recorded result |
| --- | --- |
| Build and automated checks | TypeScript build and 67 unit/contract checks passed. Includes identity mismatch rejection, ownership, reference translation, cancellation, queue release, upstream schemas, upload-path checks and minimized-capture cleanup. |
| Real Windows Chrome | Chrome 156.0.8078.74; WSL-hosted Node broker; existing debugging-enabled profile. |
| Minimized screenshot fixtures | Two explicitly synthetic client identities made six alternating fresh-content screenshots, including full-page capture. Three further captures succeeded after a detached-element failure and a pending-request cancellation, including the cancelled page. |
| Real Codex thread | One actual admin conversation completed a minimized screenshot through the registered MCP. |
| OS focus and minimization observation | 116.674 seconds, 7,325 samples; no foreground-HWND or IsIconic changes recorded. Largest sampling gap was 71 ms. Sampling does not exclude shorter unobserved events. |
| Cleanup | Disposable fixture pages and the real thread's test pages were closed; the previous ordinary active tab was restored. Shared Chrome remained minimized. |
| Earlier identity validation | Codex CLI 0.162.1/0.163.0 new/resume/fork metadata and exact mapping were checked during development. Identity is contract-based, not a promise that every later CLI build has been tested. |

The tests above do not establish all-platform compatibility, arbitrary-browser-restart recovery, every website, multiple real CLI conversations on the latest adapter version, or OS-native print/save/certificate dialogs. New installations must confirm that their Codex calls supply the required metadata and both loopback directions are reachable.

## Public-source packaging verification

The initial public source adds one archive/install regression, bringing `npm test` to 68 checks. It exercises packaging, credential/private-document exclusion and installation with relative dependency links, then removes the source and extraction directories before executing the installed fixture. This addresses a portability issue found during clean-checkout preparation; it does not replace the original real-browser evidence above.

## Running checks

```bash
npm ci --ignore-scripts
npm run build
npm test
```

These commands do not launch or mutate a live browser session. The contract check reads the pinned upstream tool schemas.

`tests/live-*.mjs` are opt-in integration harnesses, not the default test suite. They have different setup requirements. Some older harnesses require prior real CLI transcripts in ignored `.artifacts/`; do not substitute guessed or another user's thread IDs. The minimized fixture uses disposable synthetic identities and an owned live target as its extension-inspection anchor:

```bash
node tests/live-minimized-capture.mjs OWNED_TARGET_ID .artifacts/minimized-run
```

It requires an already-installed adapter, connected extension and a window deliberately minimized for the test. It does not minimize or restore the OS window itself. `CBW_WINDOWS_FIXTURE_ROOT` selects the disposable Windows-mounted directory for the dialog/upload harness.

The closed-thread harness requires the installed broker to match the source package version and a separate owned anchor page. It uses ephemeral Codex app-server threads, never an existing conversation:

```bash
CBW_INSTALLED_DIST=/absolute/install/dist node tests/live-thread-cleanup.mjs \
  OWNED_TARGET_ID /absolute/state/config.json .artifacts/thread-cleanup-live.json
```

Set `CBW_EXPECTED_PROJECT` to the expected repository/project label to also assert the group names of those ephemeral threads.

No browser integration test is run automatically on push. Do not enable paid hosted checks without an explicit scope and budget.
