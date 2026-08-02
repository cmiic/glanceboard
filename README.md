# Glanceboard

An at-a-glance **wall of live website previews and grouped RSS headlines**, as a Firefox extension.
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
- **RSS discovery and groups.** When a page advertises an RSS feed, choose the website, the feed,
  or both. Put several related feeds into one named tile and merge their newest headlines.
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

- **Desktop:** every tile renders live and is interactive; the wall auto-refreshes every ~2 minutes
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

## RSS feeds

- Adding a site checks its RSS metadata and a small set of conventional feed paths. Direct RSS URLs
  work too; supported ORF Sound podcast pages use ORF's public podcast metadata to find their feed.
- A feed belongs to one group. Each non-empty group is one dashboard tile showing up to 30 headlines,
  newest first, with source and publication date. Item artwork stays within the height of a two-line
  headline, with the normalized plain-text description below it. Use the **Feeds** tab to show or hide
  images and descriptions per feed and set an optional description character limit (`0` keeps all),
  as well as to create or rename groups, move feeds, re-grant access, or remove them.
- Feed data is fetched sequentially when the dashboard opens and when you press a feed tile's refresh
  button. The latest 50 normalized items per feed are cached locally, so a temporary failure leaves
  the previous headlines visible. Feeds are never polled in the background.
- RSS 1.0 and 2.0 are supported in this release; Atom, JSON Feed, rendered HTML content, media playback,
  and unread tracking are not yet supported.

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
- **Metrics** — default cert/load tile visibility for new sites, plus show/hide-all.
- **Notifications** — local alert when a host goes down (only while checks are on).
- **Card size** and **Layout** (auto / desktop / mobile).
- **Export / Import** sites, RSS feeds, and feed-group membership as versioned JSON. Existing host-only
  export files remain importable.

## Opening it / setting it as your home page

Glanceboard does **not** override your new-tab page — installing it won't change your browser. Open the
dashboard from the **toolbar button** (or bookmark it).

To make it your **homepage / new windows**: copy the dashboard URL from **Settings → Open / home page**
and paste it into Firefox **Settings → Home → "Homepage and new windows" → Custom URLs**. (Firefox only
lets an extension take over the *new-tab* page by overriding it at install time, which Glanceboard
deliberately does not do.)

See [SECURITY.md](SECURITY.md) for the permission/security model and [TESTING.md](TESTING.md) for tests.
