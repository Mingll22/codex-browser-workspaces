# Contributing

Use Node.js 22.22+ in WSL. Run `npm ci --ignore-scripts`, `npm run build`, and `npm test` for changes affecting runtime behavior. Documentation-only changes need link and diff review. Browser fixtures are opt-in; protect existing profiles, tabs and login state, and use only positively owned disposable test pages.

`main` is the development integration branch. Use a short-lived topic branch and a pull request for a complete feature or repair. Keep related implementation, tests and documentation together. State the problem, changed behavior, checks and remaining limits. Do not submit a separate PR for every commit. No paid cloud CI is configured; local validation is the default.

The initial history imports an existing local implementation in several honest batches. Commit timestamps describe that import, not the dates when its individual features were first developed.

Do not commit `.artifacts`, `dist`, dependencies, generated extension pairing configuration, runtime ledgers, local reports or machine-specific handoffs. The checked-in extension public key fixes its origin ID; it is not a pairing secret. Avoid changing it casually because existing installations use that origin.

Upstream changes belong in the pinned build-time patch with exact anchor checks. Preserve upstream notices, and describe modifications in `docs/UPSTREAM.md`. Do not edit installed `node_modules` or relax ownership to make a fixture pass.

Worktrees do not isolate Chrome, ports or services. Serialize shared runtime upgrades and acceptance calls. Use Chrome DevTools MCP for browser integration; do not introduce Playwright as an alternate execution path for this project.

By submitting a contribution you agree to license it under the repository's Apache-2.0 license. Include a sanitized reproduction for bugs and omit account data, URLs containing credentials and pairing tokens.
