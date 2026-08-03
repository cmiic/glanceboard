# Testing

## Automated (unit) tests

Pure logic in `src/lib/` is covered by Node's built-in test runner. `linkedom` supplies the detached
`DOMParser` used by XML feed fixtures because Node does not provide the browser API:

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
- `test/rss.test.js` — RSS 1.0/2.0 parsing, safe description/image normalization, URL safety, cache
  validators, response bounds, podcast enclosures, truncation, and merged ordering.
- `test/atom.test.js` and `test/json-feed.test.js` — Atom and JSON Feed parsing, safe content
  normalization, relative URLs, validators, and audio attachments.
- `test/feed-discovery.test.js` — multi-format HTML/header/common-path discovery, redirects, direct
  feeds, and the ORF adapter.
- `test/feed-adapters.test.js` — typed feed and discovery extension-point registries.
- `test/feed-polling.test.js`, `test/feed-refresh.test.js`, and `test/feed-refresh-queue.test.js` —
  adaptive scheduling, backoff, due-source selection, queue coalescing and alarm reconstruction,
  sequential refresh, permission failures, stale fallback, and batched cache writes.
- `test/feed-read.test.js` — read-marker normalization, group filter cycling/counting, filtering before
  the display cap, and serialized mutations.
- `test/backup.test.js` — versioned site/feed/Read Later/read-state export plus legacy import
  compatibility.

Browser-coupled code (the background page, Vue components, iframe behaviour) is verified manually.

## Manual checklist (Firefox)

Build (`npm run build`) and load `.output/firefox-mv2/manifest.json` via `about:debugging`.

- **Passive by default:** a fresh profile makes no background network requests until you set a check
  interval.
- **Add a host:** grant the per-host permission → a live preview appears with a last-check time, and
  **no** cert/load tiles until you enable them.
- **Feed discovery:** add pages advertising RSS, Atom, and JSON Feed → choose Website, Feed, or Both; choose an
  existing group or create one, then verify the group becomes one tile.
- **Cross-origin RSS:** add the ORF Matrix podcast page → grant ORF's discovery/feed origins and verify
  its podcast headlines load. Add `https://brgenns.ac.at/` → follow the redirect and verify `/feed/`
  is discovered.
- **Feed groups:** add two feeds to one group, move one to another group, rename both groups, refresh a
  tile, and verify cached headlines remain when one source is unavailable. Toggle images and
  descriptions independently for each feed and verify the description character limit, including `0`.
- **Direct RSS 1.0:** paste `https://rss.orf.at/news.xml` and verify the dialog identifies it as a feed
  rather than offering to add it as a website.
- **Podcasts:** add a podcast feed, start an episode, seek and change speed, switch tabs and episodes,
  close/reopen the dashboard, then verify the saved position resumes when that episode is selected.
- **Read Later:** save and unsave feed items, remove the original feed, verify saved snapshots remain,
  play a saved podcast, and confirm Clear all before removal.
- **Read/unread:** verify new and existing items start unread; mark several items read quickly and
  confirm they disappear from Unread. Cycle through Read, All, and Unread, revert one item to unread,
  reload the dashboard, and verify the group filter and markers persist. Repeat in two dashboard tabs.
- **Background feeds:** verify it is globally off after upgrade. Enable it, exercise Auto/fixed/Off per
  feed, inspect last/next times, restart Firefox to reconstruct the alarm, and verify a failed feed
  keeps stale items without blocking successful sources.
- **Header stripping:** add a site that sends `X-Frame-Options` (e.g. an Oracle APEX login) — it should
  render in the grid. A site with frame-busting JS must **not** navigate your dashboard away (sandbox).
- **Metrics:** toggle cert/load per site (Hosts tab) and via Settings (default + apply-to-all).
- **Layout:** switch Auto / Desktop / Mobile in Settings — the grid updates without a reload.
- **Checks + notifications:** set an interval, add an unreachable host (e.g. `https://nope.invalid`),
  enable notifications → expect a "host unreachable" notification on the next cycle.
- **Export / Import:** export the data, remove sites/groups/saved items, re-import → one permission
  prompt restores site URLs, typed feed URLs, empty groups, group membership, polling choices, and
  Read Later, group filters, and read markers. Use a v4 file containing both Read Later items and
  permission-requiring sites/feeds; Firefox must show the permission prompt without a user-gesture
  error. Also import an older `{ "hosts": [...] }` file.

## Adding a test

Drop a `*.test.js` into `test/` using `node:test` + `node:assert/strict`, importing the module under test
from `../src/lib/...`. For storage, install an in-memory `globalThis.browser` mock **before** importing
`storage.js` (see `test/storage.test.js` — `browser.js` binds the global at evaluation time).
