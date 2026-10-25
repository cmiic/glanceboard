# Testing

## Automated (unit) tests

Pure logic in `src/lib/` is covered by Node's built-in test runner. `linkedom` supplies the detached
`DOMParser` used by XML feed fixtures because Node does not provide the browser API:

```bash
npm test     # runs: node --test  (over test/*.test.js)
npm run test:coverage  # the same, plus src/ line/branch coverage as LCOV in coverage.lcov
```

The SonarQube Cloud workflow runs `test:coverage` before its scan; the scanner reads `coverage.lcov`
(see `sonar-project.properties`).

Suites:

- `test/url.test.js` — `normalizeHost()` parsing/normalisation and rejection of invalid input.
- `test/thresholds.test.js` — the red-state boundaries (`isCertExpiringSoon`, `isLoadSlow`, `isStale`).
- `test/headers.test.js` — `stripFramingHeaders()` **(security-critical)**: removes `X-Frame-Options`,
  strips only the CSP `frame-ancestors` directive, and leaves everything else intact.
- `test/storage.test.js` — host CRUD + dedupe, per-host metric flags, the rolling results buffer
  (newest-first, capped, sticky cert), settings defaults, and folding per-key storage changes into
  the dashboard's maps — against an in-memory `browser.storage.local` mock.
- `test/monitor.test.js` — `checkHost()` ok / error / timeout result shape (with a stubbed `fetch`).
- `test/rss.test.js` — RSS 1.0/2.0 parsing, safe description/image normalization, URL safety, cache
  validators, response bounds, podcast enclosures, truncation, and merged ordering.
- `test/atom.test.js` and `test/json-feed.test.js` — Atom and JSON Feed parsing, safe content
  normalization, relative URLs, validators, audio attachments, item identity, and the item cap.
- `test/feed-discovery.test.js` — multi-format HTML/header/common-path discovery, redirects, direct
  feeds, and the ORF adapter.
- `test/feed-adapters.test.js` — typed feed and discovery extension-point registries.
- `test/feed-selection.test.js` — the add dialog's review step: selection checks, origin patterns,
  redirected feeds, and the site/feed/group request handed to storage.
- `test/feed-polling.test.js`, `test/feed-refresh.test.js`, and `test/feed-refresh-queue.test.js` —
  adaptive scheduling, backoff, due-source selection, queue coalescing and alarm reconstruction,
  sequential refresh, permission failures, stale fallback, and batched cache writes.
- `test/feed-read.test.js` — read-marker normalization, group filter cycling/counting, filtering before
  the display cap, and serialized mutations.
- `test/backup.test.js` — versioned site/feed/Read Later/read-state export plus legacy import
  compatibility.

Browser-coupled code (the background page, Vue components, iframe behaviour) is covered by the browser
tests below, as far as they reach, and otherwise by the manual checklist.

## Browser tests (Firefox, local)

`npm run test:e2e` builds the extension and drives a real, headless Firefox with it installed, through
`puppeteer-core` and WebDriver BiDi. It needs Firefox 142 or newer — the manifest's
`strict_min_version` — on `PATH`, or `FIREFOX_BIN` pointing at it; nothing is downloaded. Like the other
npm scripts it expects a POSIX shell (Linux, macOS or WSL). `E2E_HEADFUL=1 npm run test:e2e` shows the
browser window.

**Run it before pushing changes to `src/ui/`, `src/entrypoints/` or code the dashboard and background
page call into.** It is not part of CI and has no git hook: it needs a local Firefox and a build, so it
stays a deliberate step before a push.

Tests (`e2e/*.e2e.js`; `npm test` does not pick them up). Each file starts one Firefox; the whole run
takes about a minute:

- `e2e/extension.e2e.js` — the built extension installs and its dashboard opens; `permissions.request()`
  succeeds from a click but fails after an `await` in the handler; and adding a page whose feed is on
  another host grants each host from its click, adds the feed, and drops the discovery-only grant.
- `e2e/framing.e2e.js` **(security-critical)** — a site sending `X-Frame-Options: DENY` and CSP
  `frame-ancestors 'none'` renders in its preview with its other CSP directives still enforced; a framed
  page cannot navigate the dashboard away; an ordinary site embedding an added site gets nothing
  stripped; and an added site redirecting to a granted-but-not-added origin leaves that origin protected.
- `e2e/feeds.e2e.js` — two feeds in one group make one tile; creating a group, moving a feed into it and
  renaming both groups; each feed's image, description and description limit (including `0`); a failing
  feed keeping its cached headlines on refresh; a feed URL entered directly offered as a feed.
- `e2e/backup.e2e.js` — a backup exported from Settings restores sites, typed feed URLs, empty groups,
  membership, polling choices, group filters, Read Later and read markers after a reset, through the
  permission request of the real "Grant & import" click; an older `{ "hosts": [...] }` file; and the
  messages for a file that is not JSON or holds nothing valid.
- `e2e/keyboard.e2e.js` — real key presses: Tab reaches the popup's rows in order, Enter opens a site and
  Space a feed group's dashboard; Enter on a preview overlay in the mobile layout opens its site; and
  clicking each Settings label focuses its control.
- `e2e/live-updates.e2e.js` — with two dashboard tabs open, a site added, a check result written, a feed
  cache refreshed and an item marked read in one show up in the other without a reload.

Each was also run against a deliberately broken build: with an `await` before the add flow's or the
import's permission request, without the framing-header stripping or either of its two guards
(`isFromOwnExtension()`, `isApprovedTarget()`), or without the dashboard's `storage.onChanged`
listener, the tests for that behaviour fail.

How the harness (`e2e/harness.js`) gets a WebDriver session into an extension page, for whoever adds a
test:

- **Permission prompts are off** (`extensions.webextOptionalPermissionPrompts`), so a request is
  granted without the doorhanger — but only from a user gesture, as in normal use.
- **The extension's UUID is pinned** (`extensions.webextensions.uuids`), so its pages live at
  `EXTENSION_BASE`. BiDi navigates only to http(s), file and blob URLs unless Firefox runs with
  `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`, and it never reports the navigation to a `moz-extension://` page as
  finished: open pages with `openExtensionPage()`, not `page.goto()`. Each opened page gets a unique
  `#e2e-<n>` hash, so input finds its tab even when the extension opens another on the same page.
- **Input goes through the harness, never `page.click()`, `page.type()` or `page.keyboard`.** Firefox
  treats extension pages as privileged, and WebDriver refuses to send input into them. `click()` and
  `clickButton()` synthesize mouse events in the browser window at the element's position, and
  `press()` sends keys through the browser window's text input processor (as Firefox's own
  `EventUtils.synthesizeKey` does); Firefox delivers both as trusted input, so a click, Enter or Space
  counts as a user gesture. Both select the page's tab first and let a tab switch settle. `fill()`,
  `choose()` and `setFile()` set a field, a `<select>` or a file input by script and fire its events,
  since typing needs no gesture.
- **Fixtures come from `startFixtureServer()`** on loopback. `127.0.0.1` and `localhost` are different
  hosts to the extension's per-host permissions, so a page on one can advertise a feed on the other.
  Routes are looked up per request, so a test can change what a URL serves; `requests` logs every
  request. Keep fixture feeds off the conventional paths (`/feed.xml`, `/rss` …): discovery probes those
  when a page advertises nothing, which turns adding a site into a feed review.
- **`e2e/flows.js`** has the app-level steps: `resetExtension()` (storage and host permissions cleared,
  desktop layout), `openDashboard()`, `addSite()`, `addFeeds()` and `waitForStorage()`.

## Manual checklist (Firefox)

Build (`npm run build`) and load `.output/firefox-mv2/manifest.json` via `about:debugging`. The browser
tests cover header stripping, feed groups and display settings, export and import, keyboard access, and
live updates; this list is what they do not reach.

- **Passive by default:** a fresh profile makes no background network requests until you set a check
  interval.
- **Metrics:** a newly added site shows **no** cert/load tiles until you enable them; toggle cert/load
  per site (Sites tab) and via Settings (default + apply-to-all). The cert tile needs a real TLS site.
- **Feed discovery:** add pages advertising Atom and JSON Feed, and try the Both choice.
- **Cross-origin RSS:** add the ORF Matrix podcast page → grant ORF's discovery/feed origins and verify
  its podcast headlines load. Add `https://brgenns.ac.at/` → follow the redirect and verify `/feed/`
  is discovered.
- **Podcasts:** add a podcast feed, start an episode, seek and change speed, switch tabs and episodes,
  close/reopen the dashboard, then verify the saved position resumes when that episode is selected.
- **Read Later:** unsave items, remove the original feed, verify saved snapshots remain, play a saved
  podcast, and confirm Clear all before removal.
- **Read/unread:** mark several items read quickly; cycle through Read, All, and Unread, revert one item
  to unread, reload the dashboard, and verify the group filter and markers persist.
- **Background feeds:** verify it is globally off after upgrade. Enable it, exercise Auto/fixed/Off per
  feed, inspect last/next times, restart Firefox to reconstruct the alarm, and verify a failed feed
  keeps stale items without blocking successful sources.
- **Layout:** switch Auto / Desktop / Mobile in Settings — the grid updates without a reload, and looks
  right in each.
- **Checks + notifications:** set an interval, add an unreachable host (e.g. `https://nope.invalid`),
  enable notifications → expect a "host unreachable" notification on the next cycle.

## Adding a test

Drop a `*.test.js` into `test/` using `node:test` + `node:assert/strict`, importing the module under test
from `../src/lib/...`. For storage, install an in-memory `globalThis.browser` mock **before** importing
`storage.js` (see `test/storage.test.js` — `browser.js` binds the global at evaluation time).

A browser test goes into `e2e/` as `*.e2e.js`, using the helpers in `e2e/harness.js` (see "Browser tests"
above). Prefer a unit test in `test/` whenever the logic can live in `src/lib/`.
