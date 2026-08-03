# Security

Glanceboard runs entirely in your browser. There is **no backend and no telemetry** — your host list,
settings, and check results live only in the extension's local storage, and nothing is sent anywhere.

## Permissions

- `storage`, `alarms`, `notifications` — local state, the optional periodic-check timer, and local
  "host down" notifications.
- `webRequest` + `webRequestBlocking` — to (a) read the TLS-certificate expiry of sites you preview and
  (b) strip framing-protection headers so they can be embedded (see below).
- **Host access is per-site or per-feed and optional.** Glanceboard requests permission for an exact
  origin only when you add (or import) a website or feed — it does **not** request access to all sites
  by default. Feed discovery may require a second exact-origin prompt when a page advertises a feed on
  another host. Permissions are retained while any saved site or feed needs them and revoked afterward.
  Discovery-only grants are removed when the add flow ends; if its tab is closed mid-flow, background
  startup reconciles granted exact origins against saved sites and feeds and removes any orphaned grants.
- **Adding a single page still grants the whole host.** You can monitor one page (`example.com/status`)
  rather than a site root, but the permission Firefox grants — and therefore the framing-header stripping
  described below — applies to that page's entire origin, not just its path. Adding a page is exactly as
  privileged as adding its host.

## Framing-header stripping (the notable part)

To show a live preview, Glanceboard embeds each site in a sandboxed `<iframe>`. Many sites forbid this
with `X-Frame-Options` or a CSP `frame-ancestors` directive, so the extension removes those response
headers. This is tightly constrained:

- It runs **only for sites you explicitly added** — Firefox dispatches the request listener solely for
  origins you've granted permission to, *and* the extension independently re-checks that the framed
  target's origin is one you added, whether you added it as a whole site or as a single page on it.
  So ordinary browsing is never affected, and a monitored site that redirects to an unrelated origin
  does not get that origin de-protected.
- It runs **only inside our own preview iframes** — the request's embedder must be the Glanceboard
  dashboard, so another site embedding a monitored site gains nothing.
- Only the **framing** restriction is removed: `X-Frame-Options` is dropped and `frame-ancestors` is
  stripped from CSP; **all other CSP directives are preserved**.
- Preview iframes are **sandboxed without `allow-top-navigation`**, so an embedded page cannot navigate
  or hijack your dashboard (frame-busting is neutralised).

Trade-off: while Glanceboard is installed, the sites you added can be framed (clickjacking protection for
*those* sites is relaxed within your own browser). Add only sites you trust enough to view this way. This
capability requires **Manifest V2** — Firefox MV3 forbids modifying these headers.

## Off by default

Background site checks and background feed refresh are **off** until you opt in, so the extension does
not poll, consume bandwidth, or put load on anyone's servers unless you choose to. Certificate and
load-time data are gathered only from previews you actually open. Feeds are otherwise fetched when the
dashboard opens or when you manually refresh a feed tile. Background feed refresh is sequential,
individually configurable, and bounded between hourly and daily in Auto mode.

## Feed content and media

RSS, Atom, and JSON Feed are untrusted remote input. Glanceboard accepts RSS 1.0/2.0, Atom, and JSON Feed
1.0/1.1 only over HTTP(S), rejects XML documents with a DOCTYPE, caps responses at 2 MB, and stores a
bounded set of normalized titles, links, dates, plain-text descriptions, image URLs, and podcast
metadata. Feed markup is parsed in a detached document and is never injected with `innerHTML` or Vue's
`v-html`; scripts and embedded markup are not rendered. Item, image, and audio URLs are restricted to
HTTP(S).

Remote images load lazily without an HTTP referrer and can be disabled per feed. Starting podcast
playback makes a streaming request to the enclosure or attachment host; audio bytes are never cached by
Glanceboard. Read Later stores compact metadata snapshots locally, not article or media contents.
Read/unread tracking stores only bounded feed-source/item identifiers and read timestamps locally. These
markers are included when you explicitly export a Glanceboard backup and are removed with their feed.

## Reporting a vulnerability

Please email [c@miic.at](mailto:c@miic.at) with the details. Don't open a public issue for security problems.
