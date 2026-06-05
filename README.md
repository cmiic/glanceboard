# Glanceboard

An at-a-glance **wall of live website previews**, as a Firefox extension. Add the sites you want to keep
an eye on and Glanceboard shows them as a grid of live, scaled-down previews — handy for a quick visual
check, or for periodically eyeballing sites that don't offer a feed or other update channel. You open it
from the toolbar button (and can set it as your homepage — see below).

It is deliberately **soft monitoring**: a quick human glance, not a real monitoring/alerting system.

## Highlights

- **Live previews** of any site — rendered in your own browser session, so pages you're logged into show
  their logged-in view. Works even on sites that normally forbid embedding (see Security).
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

- **Desktop:** every tile renders live and is interactive; the wall auto-refreshes when you enable a
  check interval. Use the ↗ button to open a site in a new tab, ⟳ to reload a tile.
- **Android:** tiles render lazily as you scroll; tap a tile to open the site.

## Install / develop

```bash
npm install
npm run dev            # build + launch in Firefox (desktop) via WXT
npm run build          # build into .output/firefox-mv2/
npm run zip            # package a distributable .zip
npm test               # node:test unit suites (src/lib)
npm run lint           # eslint + markdownlint
```

Built with [WXT](https://wxt.dev). Or load it manually: `about:debugging` → **Load Temporary Add-on** →
pick `.output/firefox-mv2/manifest.json`.

## Settings

(Toolbar popup → **Open dashboard** → **Settings** tab.)

- **Check interval** — Off (default) or every 1–60 minutes. Off = fully passive.
- **Metrics** — default cert/load tile visibility for new sites, plus show/hide-all.
- **Notifications** — local alert when a host goes down (only while checks are on).
- **Card size** and **Layout** (auto / desktop / mobile).
- **Export / Import** the host list as JSON.

## Opening it / setting it as your home page

Glanceboard does **not** override your new-tab page — installing it won't change your browser. Open the
dashboard from the **toolbar button** (or bookmark it).

To make it your **homepage / new windows**: copy the dashboard URL from **Settings → Open / home page**
and paste it into Firefox **Settings → Home → "Homepage and new windows" → Custom URLs**. (Firefox only
lets an extension take over the *new-tab* page by overriding it at install time, which Glanceboard
deliberately does not do.)

See [SECURITY.md](SECURITY.md) for the permission/security model and [TESTING.md](TESTING.md) for tests.
