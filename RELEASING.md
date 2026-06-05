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
src/lib/headers.js and src/entrypoints/background.js). Host access is per-site and optional
(optional_permissions), requested only when the user adds a site.

How to test: open the dashboard (toolbar button -> Open dashboard) -> Hosts tab -> add any public site
(for example https://example.com); it appears as a live preview tile. No login required.

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

## About the innerHTML validator warning

AMO's validator reports a non-blocking **Warning**: "Unsafe assignment to innerHTML" in
`chunks/base-<hash>.js`. That file is the bundled Vue runtime, and the assignment is Vue's generic DOM
prop-patcher, not application code. Our source contains no `innerHTML` or `v-html`
(`grep -rn "innerHTML\|v-html" src/` is empty), so nothing dynamic is ever written as HTML. The warning
is inherent to bundling Vue and cannot be removed without dropping the framework — it is safe to proceed.
