# Validation and compatibility

## Formal root-family installation and 0.4.1 acceptance repair, 2026-11-09

Adapter and extension **0.4.0** were formally loaded with page model 2 and upstream **1.11.0**. Migration preserved the extension generation and exact tab/target/group/window receipts, with no family multi-group conflict, group-name matching, browser restart or login/profile replacement. Admin/code allowlists contain 27 tools and design retains its 24-tool subset. A fresh client loads the installed stdio code; already-running TUI tool catalogs need their own reconnect/reload before exposing newly allowed tools.

The **0.4.1** follow-up repairs a real reimport failure and applies the user's fixed-light, footer-free popup. Five additional lease/workspace regressions bring the local checks to **153/153**. Those checks remain fixtures: the new real evidence below is separate. Local detailed receipts, failures, screenshots, cleanup and installation reports are private runtime artifacts rather than public-source test data.

| Acceptance behavior | Observed real 0.4 evidence | Limits or follow-up |
| --- | --- | --- |
| Manual drag-in/out/back | Exact original targets appear/disappear with current membership; old handles fail | Test-owned objects only |
| A → independent B transfer | A loses access; B sees the original target as external/protected | No real user page moved |
| Active discovery independent of move | Discover X, activate Y, then import the original X | State nonce and target remain stable |
| Empty family imports original tab | No extra blank tab or refresh; a repeated import exposed an immediately expired returned lease | 0.4.1 adds an executing-grant membership handoff and requires live repair retest |
| Position/order/lease gaps | Four disposable tabs follow actual Chrome reorder; real family caller filtering preserves original positions | Positions are interpreted from the full group before filtering |
| Root/child/grandchild and independent family | Real native caller IDs and official spawn edges share one exact group; independent no-model host roots use separate groups | No guessed or database-inserted identity |
| Sibling race/old ID denial | Concurrent real children: one evaluate succeeds, the other gets PAGE_LEASE_BUSY before execution and its list hides the target | The losing action is never replayed |
| List/renewal/old UID | List does not change lease timestamps; page operation renews; release/idle expiry rejects old ID and UID | Actual idle observation exceeded five wall-clock minutes |
| In-flight/timeout/UNKNOWN | A bounded live action excludes another root; known wait timeout settles without UNKNOWN | UNKNOWN across the real expiry boundary and its exact reconciliation are recorded by the admin run |
| External close protection | Explicit close refuses imported pages despite retention changes; process-exit cleanup preserves external/retained pages | Fixture closure is an exact simulated user action |
| Single/main/last/group closure | Missing targets remain absent across list, old-ID use and host reconnect | No automatic blank-tab recreation |
| One child ends | A descendant ends while another family actor continues; exact target/group receipts survive | Host completion and registered process exit are distinguished |
| Read-only DB/cache | Actual broker database file descriptor is read-only; native ancestry is verified against historical edges | Cache/failure semantics remain isolated unit checks; shared DB is never altered |
| Existing regressions | Explicit slots/same URL, extension-page mapping, reconnect, background and own minimized-window screenshots | No artificial discovery delay injected; shared window is never minimized for testing |

Real lifecycle fixtures use official host thread/name/set and thread/inject_items to persist dedicated no-model threads, then gate on broker visibility. They never insert SQLite rows or start a model turn. Successful cleanup verifies exact created targets absent and dedicated threads archived. Older harnesses with synthetic caller identities retain their version gates.

## Extension popup

The toolbar badge uses actual registered MCP connections. The installed 0.4 popup was checked against broker counts and current Chrome groups; its copy action was historically exercised before the user removed that feature. The current 0.4.1 surface is fixed light, with connection, metrics, workspaces and refresh only; it removes the entire version/time/diagnostic footer and clipboardWrite permission. Unknown values and stale/error notices stay explicit, and long titles remain keyboard accessible. Final loaded light-theme screenshots and interactions are recorded by admin; historical dark/sample screenshots do not establish current UI acceptance.

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
