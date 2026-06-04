# Testing

## Automated (unit) tests

Pure logic in `src/lib/` is covered by Node's built-in test runner — no extra dependencies:

```bash
npm test     # runs: node --test  (over test/*.test.js)
```

Suites:

- `test/url.test.js` — `normalizeHost()` parsing/normalisation and rejection of invalid input.
- `test/thresholds.test.js` — the red-state boundaries (`isCertExpiringSoon`, `isLoadSlow`, `isStale`).
- `test/headers.test.js` — `stripFramingHeaders()` **(security-critical)**: removes `X-Frame-Options`,
  strips only the CSP `frame-ancestors` directive, and leaves everything else intact.
- `test/storage.test.js` — host CRUD + dedupe, per-host metric flags, the rolling results buffer
  (newest-first, capped, sticky cert), and settings defaults — against an in-memory
  `browser.storage.local` mock.
- `test/monitor.test.js` — `checkHost()` ok / error / timeout result shape (with a stubbed `fetch`).

Browser-coupled code (the background page, Vue components, iframe behaviour) is verified manually.

## Manual checklist (Firefox)

Build (`npm run build`) and load `dist/manifest.json` via `about:debugging`.

- **Passive by default:** a fresh profile makes no background network requests until you set a check
  interval.
- **Add a host:** grant the per-host permission → a live preview appears with a last-check time, and
  **no** cert/load tiles until you enable them.
- **Header stripping:** add a site that sends `X-Frame-Options` (e.g. an Oracle APEX login) — it should
  render in the grid. A site with frame-busting JS must **not** navigate your dashboard away (sandbox).
- **Metrics:** toggle cert/load per site (Hosts tab) and via Settings (default + apply-to-all).
- **Layout:** switch Auto / Desktop / Mobile in Settings — the grid updates without a reload.
- **Checks + notifications:** set an interval, add an unreachable host (e.g. `https://nope.invalid`),
  enable notifications → expect a "host unreachable" notification on the next cycle.
- **Export / Import:** export the list, remove a host, re-import → one permission prompt, host returns.

## Adding a test

Drop a `*.test.js` into `test/` using `node:test` + `node:assert/strict`, importing the module under test
from `../src/lib/...`. For storage, install an in-memory `globalThis.browser` mock **before** importing
`storage.js` (see `test/storage.test.js` — `browser.js` binds the global at evaluation time).
