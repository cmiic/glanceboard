# Releasing Glanceboard to Firefox Add-ons (AMO)

Glanceboard ships as a **listed** add-on on addons.mozilla.org. This is the repeatable release process.

## Prerequisites

- AMO API credentials in a local, gitignored `.env`: `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`,
  `FIREFOX_JWT_SECRET`, and `FIREFOX_CHANNEL=listed`. See [.env.example](.env.example); get the issuer and
  secret at <https://addons.mozilla.org/developers/addon/api/key/>.
- After a clean `npm install`, run `npm run prepare` once. The repo sets `ignore-scripts=true`, so the
  `prepare` step is not auto-run (see the README's note on `ignore-scripts`).

## Build the artifacts

```bash
npm run zip    # -> .output/glanceboard-<version>-firefox.zip  and  ...-sources.zip
```

AMO requires the **sources** archive in addition to the extension zip, because the add-on ships
bundled/minified code. WXT generates the sources zip automatically for the Firefox target.

## First listing (one-time, via the AMO web UI)

`npm run submit` can only *update* an existing add-on, so the **first** version is uploaded through the
Developer Hub:

1. Go to <https://addons.mozilla.org/developers/addon/submit/> and choose **On this site** (listed).
2. Upload `.output/glanceboard-<version>-firefox.zip`. When prompted about minified code, upload
   `.output/glanceboard-<version>-sources.zip`.
3. Fill in the listing fields (below), paste the **Notes to Reviewer** and **Version notes** (below), then
   submit.

Listing fields:

- **Summary** (<=250 chars): "An at-a-glance wall of live website previews. Add the sites you want to
  watch and Glanceboard shows them as a grid of live, scaled-down previews — a quick visual check for
  sites without a feed. Fully local: no account, no backend."
- **Category:** Tabs (Alerts & Updates also fits the optional down-notifications).
- **License:** MIT. **Support:** the GitHub repo and `c@miic.at`.
- **Screenshot:** at least one of the preview wall.
- **Privacy policy:** not required — the manifest declares `data_collection_permissions: none` and the
  add-on sends nothing anywhere.

## Subsequent versions

1. Bump `version` in `package.json` (WXT syncs it into the built manifest).
2. Run `npm run submit:dry` to validate credentials without uploading, then `npm run submit` to build,
   zip, and upload to the listed channel.
3. **Tag the published commit** so the AMO version can be traced back to source. Pass the commit
   explicitly — `git tag` defaults to `HEAD`, which is not necessarily what was uploaded:

   ```bash
   git tag -a v<version> <commit> -m "<version> — on AMO (status: <status>)"
   git push origin v<version>
   ```

   `<status>` is what AMO reports for that version at tagging time — a freshly uploaded version is
   usually awaiting review rather than `public`.

   Submit from the merged commit where possible, so `<commit>` is unambiguous. If a release was
   submitted from a feature branch before merging (0.2.0 was), confirm the merged commit carries the
   same source before tagging it, then tag the merged commit:

   ```bash
   git rev-parse <branch-commit>^{tree} <merged-commit>^{tree}   # the two hashes must match
   ```

   Tag only what was actually submitted. A version that gets bumped but never uploaded (0.2.1 and
   0.3.0 both were) gets **no** tag, so every tag in the repo corresponds to a version that exists on
   AMO.

   To check what AMO actually holds — useful before tagging retroactively, and it does not depend on
   local memory of what was sent:

   ```bash
   curl -fsS -H "Authorization: JWT <token>" \
     "https://addons.mozilla.org/api/v5/addons/addon/glanceboard@miic.at/versions/?filter=all_with_unlisted"
   ```

   `-f` matters: without it curl exits 0 on an HTTP error and prints the error body, which reads like
   AMO returning no versions — and an empty-looking list is exactly the answer that would send you
   tagging the wrong things.

   The token is a short-lived HS256 JWT signed with `FIREFOX_JWT_SECRET`, carrying
   `{ iss: FIREFOX_JWT_ISSUER, jti, iat, exp }` — the same credentials `npm run submit` uses. It is
   not optional for this purpose: the endpoint also answers **unauthenticated**, but only with
   publicly visible versions. Here that silently omitted 0.1.0 and 0.1.1, which had been uploaded and
   later disabled — enough to produce an incomplete tag set while looking like a complete answer.

## Notes to Reviewer

Paste this into AMO's "Notes to Reviewer" field (plain text):

```text
Glanceboard is a Vue 3 + WXT extension (Manifest V2, Firefox), fully client-side: no backend, no
account, no telemetry; all state lives in storage.local.

Re: the "Unsafe assignment to innerHTML" warning (chunks/base-*.js). This is inside the bundled Vue 3
runtime (@vue/runtime-dom's prop patcher), not our code. The extension uses no v-html and assigns no
dynamic innerHTML. You can verify in the attached source archive:
    grep -rn "innerHTML\|v-html" src/
returns nothing. All UI is rendered via Vue templates with text interpolation only.

Manifest V2 is required because Glanceboard strips X-Frame-Options / CSP frame-ancestors (via a
blocking webRequest.onHeadersReceived listener) so the user's chosen sites can be shown as live
<iframe> previews; Firefox MV3 forbids modifying those headers. The strip is scoped to our own
dashboard's preview iframes only (sub_frame requests whose embedder is our extension page; see
src/lib/headers.js and src/entrypoints/background.js). Host access is per-site or per-feed and optional
(optional_permissions), requested only when the user adds or imports that site or feed. Framing-header
stripping remains allowlisted to saved website entries and is never enabled for feed-only origins.

RSS, Atom, and JSON Feed sources are fetched when the dashboard opens or the user refreshes a feed
tile. Optional background feed refresh is globally off by default; when enabled, a single one-shot
alarm refreshes due sources sequentially using per-feed adaptive, fixed, or Off settings. Feed
responses are capped at 2 MB; XML rejects actual DOCTYPE declarations and is parsed in a detached
DOMParser document. Only normalized text and HTTP(S) links/image/audio URLs are stored; feed markup
is never rendered as HTML. Podcast audio is streamed from its enclosure host only after the user
starts playback and is never cached. Read Later stores compact item metadata snapshots locally.
Read/unread tracking is explicit: opening, playing, or saving an item does not mark it read. It stores
only bounded source/item identifiers and read timestamps in storage.local, and serializes mutations
through the background page so rapid actions from multiple dashboard tabs cannot overwrite each other.

How to test: open the dashboard (toolbar button -> Open dashboard) -> Sites tab -> add any public site
(for example https://example.com); it appears as a live preview tile. A path may be added too (for
example https://example.com/index.html) to watch a single page. To test RSS, add
https://rss.orf.at/news.xml, confirm the detected feed and create a group; its headlines appear in one
feed tile. Additional feeds can be moved into that group from the Feeds tab. No login required.
Atom and JSON Feed URLs can be added the same way. Podcast enclosures show a play button, and feed
items can be saved to the dashboard's Read Later tab. To test opt-in polling, enable background feed
refresh in Settings and choose Auto, fixed, or Off for a source in Feeds. To test read state, press the
checkmark on several headlines and cycle the group filter through Unread, Read, and All; the selected
filter and read markers persist after reopening the dashboard.

Reproducible build: Node 24, then `npm install && npm run build` -> .output/firefox-mv2/.
(npm install honors ignore-scripts=true; npm run build self-runs wxt prepare.)
```

## Version notes

A short, user-facing changelog for the "Version Notes" field. For the first release:

```text
Initial release. An at-a-glance wall of live website previews: add sites and see them as live,
scaled-down preview tiles. Fully local — no account, no backend, no telemetry. Optional per-site load
time and TLS-certificate-expiry metrics, and optional periodic background checks with local down
notifications (all off by default).
```

For 0.2.0:

```text
You can now watch a single page, not just a site root: add example.com/status and it gets its own tile
and history. Several pages of the same host are separate tiles. Adding a page grants the same access as
adding its host — access is still per-host, requested only when you add something. Sites you already
watch are unaffected and keep their history.
```

For 0.2.1:

```text
Fixes the load-time chart tooltip: hovering a tile's chart now shows the reading from anywhere over the
chart, instead of only within a pixel or two of a data point. The tooltip also no longer disappears
while you are reading it when other tiles refresh. The chart draws its shaded area under the line
again, which had never rendered.
```

For 0.3.1 — the first release since 0.2.0, so it carries everything from 0.2.1 and 0.3.0 too
(neither was published):

```text
Arrange your wall: on desktop, drag a tile by its title bar to put it anywhere — beside a taller tile
or below it — and drag its right edge, bottom edge or bottom-right corner to size it. A taller tile
shows more of the page rather than magnifying it, and your arrangement scales with the window instead
of reflowing. Settings → Reset tile layout puts everything back to automatic.

Previews now load one at a time instead of all at once: each tile starts when the previous one
finishes, or after up to two seconds if it is still loading, so opening or refreshing the wall no
longer requests every site simultaneously. Background checks are spaced the same way.

Also fixes the load-time chart tooltip, which was only hoverable within a pixel or two of a data
point, and restores the shaded area under the chart line.
```

For 0.4.0:

```text
Glanceboard can now discover and read RSS feeds alongside live website previews. When a site exposes
a feed, choose whether to add the website, the feed, or both; direct RSS URLs work too.

Organize feeds into groups such as Security or Fun. Each group becomes one dashboard tile with a
newest-first headline list merged from all its feeds. Per-feed controls let you show or hide item
images and descriptions and choose the description length. Feeds refresh when the dashboard opens or
when you request it, with no background polling.

Backups now include feed groups and their sources. This release also strengthens permission cleanup,
redirect handling, bounded feed downloads, legacy text encoding, and safe RSS link/XML parsing.
```

For 0.5.0:

```text
Feeds now support Atom and JSON Feed alongside RSS, with automatic discovery and the same safe,
bounded parsing and caching.

Podcast episodes can be streamed in a sticky dashboard player with seeking, playback speeds, and
local resume positions. Save feed items to the new Read Later tab so they remain available even if
their original feed is later removed.

Optional background feed refresh is globally off by default. When enabled, each feed can adapt its
schedule to recent publication times, use a fixed interval, or disable background checks. Refreshes
remain sequential and keep stale headlines visible when one source fails.

This release also improves feed discovery, permission handling, backup/restore, scheduling, and
cache efficiency.
```

For 0.6.0:

```text
Feed groups now keep explicit read and unread status. Every group starts in an Unread view and
remembers its selected Unread, Read, or All filter, with counts for each view. Mark a headline read
with its checkmark or return it to unread later; opening links, playing podcasts, and saving to Read
Later do not change read status.

Filtering happens before the 30-headline tile limit, so each view shows its newest matching items.
Read markers are bounded to the 500 newest per feed, remain with a feed when it moves between groups,
and are removed when the feed is deleted.

Versioned backups now include group filters and read markers, while older backups remain importable.
This release also serializes read-state changes across dashboard tabs and strengthens cleanup during
feed deletion and backup restoration.
```

## About the innerHTML validator warning

AMO's validator reports a non-blocking **Warning**: "Unsafe assignment to innerHTML" in
`chunks/base-<hash>.js`. That file is the bundled Vue runtime, and the assignment is Vue's generic DOM
prop-patcher, not application code. Our source contains no `innerHTML` or `v-html`
(`grep -rn "innerHTML\|v-html" src/` is empty), so nothing dynamic is ever written as HTML. The warning
is inherent to bundling Vue and cannot be removed without dropping the framework — it is safe to proceed.
