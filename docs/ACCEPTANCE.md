# Validation and compatibility

This document distinguishes automated checks, real browser fixtures and real Codex calls. The evidence below was recorded on 2026-11-03 for adapter/extension 0.3.1 with official Chrome DevTools MCP 1.11.0.

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

No browser integration test is run automatically on push. Do not enable paid hosted checks without an explicit scope and budget.
