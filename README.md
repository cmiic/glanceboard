# Glanceboard

An at-a-glance **wall of live website previews and grouped feed headlines**, as a Firefox extension.
Add the sites, individual pages, and feeds you want to keep an eye on. Glanceboard shows live pages
beside compact headline groups — handy for a quick visual check without sending anything through a
hosted service. You open it from the toolbar button (and can set it as your homepage — see below).

It is deliberately **soft monitoring**: a quick human glance, not a real monitoring/alerting system.

> **Install (users):** Glanceboard will be on **Firefox Add-ons** (addons.mozilla.org) — listing pending
> first review; the link lands here once it's published. Until then, build from source (see
> [Install / develop](#install--develop)).

## Highlights

- **Live previews** of any site — rendered in your own browser session, so pages you're logged into show
  their logged-in view. Works even on sites that normally forbid embedding (see Security).
- **Sites or single pages.** Add `example.com` for the site root, or `example.com/status` to watch one
  page. Several pages of the same host are separate tiles with their own history.
- **Feed discovery and groups.** When a page advertises an RSS, Atom, or JSON Feed, choose the website, the feed,
  or both. Put several related feeds into one named tile and merge their newest headlines.
- **Podcasts and Read Later.** Stream podcast episodes in a sticky dashboard player, resume where you
  stopped, and save compact item snapshots independently of their original feed.
- **Read what matters.** Feed-group tiles default to unread headlines; explicitly mark items read or
  unread and cycle each group through Unread, Read, and All views.
- **Passive by default.** Out of the box Glanceboard makes **no background requests at all** — previews
  load only when you open the dashboard. Periodic background checks are strictly opt-in.
- **Opt-in metrics.** Per site you can show **load time** and **TLS-certificate expiry**; both are hidden
  by default (toggle per site, change the default, or apply to all sites at once).
- **Yours, locally.** No backend, no account, nothing leaves your browser.

## Why Firefox (and Manifest V2)

Embedding sites that send `X-Frame-Options` / CSP `frame-ancestors` requires an extension to strip those
response headers — which Firefox only permits under **Manifest V2** (MV3 forbids modifying
security-sensitive headers). Firefox is also the only mainstream browser with extensions on **Android**.

## Previews

- **Desktop:** every tile renders live and is interactive. Optional preview auto-refresh runs only
  while the tab is in focus (backgrounded tabs pause). Use the ↗ button to open a site in a new tab,
  ⟳ to reload a tile.
- **Paced loading.** Tiles load one at a time — each starts when the previous finishes, or after up
  to 2 seconds if it's still going — so opening or refreshing the wall never fires every request at
  once. Background checks are spaced the same way.
- **Arrange the wall (desktop).** Drag a tile by its title bar to put it anywhere — beside a taller
  tile or below it — and drag its right edge, bottom edge or bottom-right corner to size it. A taller
  tile shows *more of the page* rather than magnifying it. Tiles keep their arrangement as the window
  changes size; the wall is a fixed number of columns whose width scales.
  **Settings → Reset tile layout** puts everything back to automatic.
- **Android:** tiles render lazily as you scroll; tap a tile to open the site.

## Feeds

- Adding a site checks its RSS, Atom, and JSON Feed metadata plus a small set of conventional feed
  paths. Direct feed URLs
  work too; supported ORF Sound podcast pages use ORF's public podcast metadata to find their feed.
- A feed belongs to one group. Each non-empty group is one dashboard tile showing up to 30 headlines,
  newest first, with source and publication date. Item artwork stays within the height of a two-line
  headline, with the normalized plain-text description below it. Use the **Feeds** tab to show or hide
  images and descriptions per feed and set an optional description character limit (`0` keeps all),
  as well as to create or rename groups, move feeds, configure background refresh, re-grant access,
  or remove them.
- Each group defaults to **Unread** and remembers its selected Unread, Read, or All filter. The filter
  shows the matching cached-item count and is applied before the 30-headline display limit. Use the
  item checkmark to mark a headline read and the return-arrow button to mark it unread again. Opening,
  playing, or saving an item to Read Later does not change its read status.
- Feed data is fetched sequentially when the dashboard opens and when you press a feed tile's refresh
  button. With background polling off, opening checks every feed; with polling enabled, it checks
  only missing or scheduled-due feeds. A tile's refresh button always checks immediately. The latest
  50 normalized items per feed are cached locally, so a temporary failure leaves the previous
  headlines visible. Optional background refresh is globally off by default; when enabled, each feed
  can be Off, fixed at 15 minutes–24 hours, or Auto (adapting hourly–daily from recent publication
  dates). Per-feed Off suppresses scheduled background checks only; feeds are still checked when the
  dashboard opens or their tile is refreshed manually. Background refresh never creates feed
  notifications.
- RSS 1.0/2.0, Atom, and JSON Feed 1.0/1.1 are supported. Remote markup is reduced to plain text.
  Podcast enclosures and audio attachments can be streamed in one dashboard-scoped player with
  seeking, playback speed, and local resume positions.
- Use ☆ to add an item to the dashboard-only **Read Later** list. Its compact snapshot survives feed
  deletion; up to 500 entries are retained until you remove them. Read markers are tracked separately,
  with the 500 newest markers retained per feed and removed when that feed is deleted.

## Known limitations

- **Service-worker sites.** A site whose Service Worker serves its pages from cache may show Firefox's
  "can't be displayed in a frame" page in the preview on a normal load — Firefox doesn't let the
  extension strip the framing header on service-worker-cached responses. Open such a site with the **↗**
  button (new tab), or force-reload the dashboard (**Ctrl+Shift+R**) to fetch it fresh.

## Install / develop

```bash
npm install
npm run prepare        # generate WXT's types in .wxt/ — run once (see note below)
npm run dev            # build + launch in Firefox (desktop) via WXT
npm run build          # build into .output/firefox-mv2/
npm run zip            # package a distributable .zip
npm test               # node:test unit suites (src/lib)
npm run lint           # eslint + markdownlint
```

Built with [WXT](https://wxt.dev). Or load it manually: `about:debugging` → **Load Temporary Add-on** →
pick `.output/firefox-mv2/manifest.json`.

> **Note on `ignore-scripts`.** This repo sets `ignore-scripts=true` in `.npmrc` so dependency install
> hooks never run automatically — a supply-chain safety measure. The trade-off is that npm also won't
> auto-run our own `prepare` step, so run `npm run prepare` once after `npm install` to generate WXT's
> types (`.wxt/`) for your editor. `npm run dev` and `npm run build` invoke `wxt prepare` themselves, so
> **CI needs no extra step**.

### Building from source (for AMO reviewers)

Built and tested with **Node 24** (see `engines` in `package.json`). From a clean checkout, the published
add-on is reproduced by:

```bash
npm ci           # installs exactly the pinned deps from package-lock.json (ignore-scripts is on)
npm run build     # runs `wxt build`, which self-runs `wxt prepare`
```

The unsigned Manifest V2 build is written to `.output/firefox-mv2/`. `npm run build` needs no environment
variables and makes no network requests (after dependencies are installed).

Publishing to AMO — build, submit, and the reviewer notes — is documented in [RELEASING.md](RELEASING.md).

## Settings

(Toolbar popup → **Open dashboard** → **Settings** tab.)

- **Check interval** — Off (default) or every 1–60 minutes. Off = fully passive. Each entry is checked
  separately, so several pages of one host mean several requests per cycle.
- **Background feed refresh** — Off globally by default. Per-feed Auto/fixed/Off controls are in
  **Feeds**.
- **Metrics** — default cert/load tile visibility for new sites, plus show/hide-all.
- **Notifications** — local alert when a host goes down (only while checks are on).
- **Card size** and **Layout** (auto / desktop / mobile).
- **Export / Import** sites, typed feeds, feed-group membership, group filters, polling choices, Read
  Later, and read markers as versioned JSON. Feed caches, global settings, and podcast resume positions
  are not exported.
  Existing host-only and older feed exports remain importable.

## Opening it / setting it as your home page

Glanceboard does **not** override your new-tab page — installing it won't change your browser. Open the
dashboard from the **toolbar button** (or bookmark it).

To make it your **homepage / new windows**: copy the dashboard URL from **Settings → Open / home page**
and paste it into Firefox **Settings → Home → "Homepage and new windows" → Custom URLs**. (Firefox only
lets an extension take over the *new-tab* page by overriding it at install time, which Glanceboard
deliberately does not do.)

See [SECURITY.md](SECURITY.md) for the permission/security model and [TESTING.md](TESTING.md) for tests.
