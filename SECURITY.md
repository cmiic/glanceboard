# Security

Glanceboard runs entirely in your browser. There is **no backend and no telemetry** — your host list,
settings, and check results live only in the extension's local storage, and nothing is sent anywhere.

## Permissions

- `storage`, `alarms`, `notifications` — local state, the optional periodic-check timer, and local
  "host down" notifications.
- `webRequest` + `webRequestBlocking` — to (a) read the TLS-certificate expiry of sites you preview and
  (b) strip framing-protection headers so they can be embedded (see below).
- **Host access is per-site and optional.** Glanceboard requests permission for an origin only when you
  add (or import) it — it does **not** request access to all sites by default.

## Framing-header stripping (the notable part)

To show a live preview, Glanceboard embeds each site in a sandboxed `<iframe>`. Many sites forbid this
with `X-Frame-Options` or a CSP `frame-ancestors` directive, so the extension removes those response
headers. This is tightly constrained:

- It runs **only for hosts you explicitly added** — Firefox dispatches the request listener solely for
  origins you've granted permission to, so ordinary browsing is never affected.
- Only the **framing** restriction is removed: `X-Frame-Options` is dropped and `frame-ancestors` is
  stripped from CSP; **all other CSP directives are preserved**.
- Preview iframes are **sandboxed without `allow-top-navigation`**, so an embedded page cannot navigate
  or hijack your dashboard (frame-busting is neutralised).

Trade-off: while Glanceboard is installed, the sites you added can be framed (clickjacking protection for
*those* sites is relaxed within your own browser). Add only sites you trust enough to view this way. This
capability requires **Manifest V2** — Firefox MV3 forbids modifying these headers.

## Off by default

Background checks are **off** until you opt in, so the extension does not poll, consume bandwidth, or put
load on anyone's servers unless you choose to. Certificate and load-time data are gathered only from
previews you actually open.

## Reporting a vulnerability

Please email [c@miic.at](mailto:c@miic.at) with the details. Don't open a public issue for security problems.
