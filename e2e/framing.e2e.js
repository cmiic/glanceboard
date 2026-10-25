// Framing-header stripping, the security-critical part of SECURITY.md: only the dashboard's own
// previews of sites the user added get X-Frame-Options and CSP frame-ancestors removed.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { click, clickButton, launchFirefox, startFixtureServer } from './harness.js'
import { addFeeds, addSite, openDashboard, resetExtension, storageGet } from './flows.js'

const html = (body, headers = {}) => ({ headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Forbids framing two ways and forbids images, then tells its parent it rendered. The image is
// how the test sees that CSP directives other than frame-ancestors survive the stripping.
const protectedPage = ({ ip }) => html(`<!doctype html><title>Protected</title>
  <img src="${ip}/pixel.png" alt="">
  <script>parent.postMessage({ framed: location.href }, '*')</script>`, {
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self' 'unsafe-inline'; img-src 'none'; frame-ancestors 'none'"
})

let firefox
let fixtures
let dashboard

before(async () => {
  fixtures = await startFixtureServer({
    '/protected.html': protectedPage,
    '/pixel.png': () => ({ headers: { 'content-type': 'image/png' } }),
    '/buster.html': ({ ip }) => html(`<!doctype html><title>Buster</title><script>
      parent.postMessage({ buster: 'loaded' }, '*')
      try { top.location.href = '${ip}/busted.html' } catch (error) { parent.postMessage({ busterBlocked: error.name }, '*') }
      </script>`),
    '/busted.html': () => html('<!doctype html><title>Busted</title>'),
    // An ordinary page, not the dashboard, embedding a protected page that the user did add. It is
    // served from the added, granted host: Firefox only runs the extension's header listener for a
    // subframe when it holds permission for the embedder too, so only isFromOwnExtension() keeps
    // this request's headers.
    '/embed.html': ({ ip }) => html(`<!doctype html><title>Embedder</title>
      <script>addEventListener('message', event => { document.title = 'framed ' + JSON.stringify(event.data) })</script>
      <iframe src="${ip}/protected.html"></iframe>`),
    '/later-redirects': () => html('<!doctype html><title>Plain</title><script>parent.postMessage({ plain: true }, "*")</script>'),
    '/other-host.rss': () => ({
      headers: { 'content-type': 'application/rss+xml' },
      body: '<?xml version="1.0"?><rss version="2.0"><channel><title>Other host</title><item><title>One</title><guid>one</guid></item></channel></rss>'
    })
  })
  firefox = await launchFirefox()
  await resetExtension(firefox.browser)
  dashboard = await openDashboard(firefox.browser)
  // The previews' postMessage calls are the evidence that a protected page rendered in its frame.
  await dashboard.evaluate(() => {
    window.e2eMessages = []
    addEventListener('message', event => window.e2eMessages.push(event.data))
  })
})

after(async () => {
  await firefox?.browser.close()
  await fixtures?.close()
})

// Wait until a message the dashboard received matches `predicate(message, arg)`, checked here in Node.
async function waitForMessage (predicate, arg, timeout = 15000) {
  const deadline = Date.now() + timeout
  let seen = []
  while (Date.now() < deadline) {
    seen = await dashboard.evaluate(() => window.e2eMessages)
    if (seen.some(message => predicate(message, arg))) return
    await sleep(100)
  }
  throw new Error(`no matching message; received ${JSON.stringify(seen)}; requests ${fixtures.requests.join(', ')}`)
}

test('an added site that forbids framing still shows in its preview, with its other CSP directives intact', { timeout: 60000 }, async () => {
  const url = `${fixtures.hosts.ip}/protected.html`
  await addSite(dashboard, url)
  await clickButton(dashboard, '.tabs', 'Monitor') // where the previews are
  await waitForMessage((message, target) => message.framed === target, url)
  await sleep(500)
  assert.ok(!fixtures.requests.some(line => line.endsWith(' /pixel.png')),
    "img-src 'none' still applies inside the preview")
})

test('a framed site cannot navigate the dashboard away (sandbox without allow-top-navigation)', { timeout: 60000 }, async () => {
  await addSite(dashboard, `${fixtures.hosts.ip}/buster.html`)
  await clickButton(dashboard, '.tabs', 'Monitor')
  await waitForMessage(message => typeof message.busterBlocked === 'string')
  await sleep(500)
  assert.equal(await dashboard.evaluate(() => location.pathname), '/dashboard.html')
  assert.ok(!fixtures.requests.some(line => line.endsWith(' /busted.html')))
})

test('another site embedding an added site gets no stripped headers', { timeout: 60000 }, async () => {
  const page = await firefox.browser.newPage()
  const before = fixtures.requests.filter(line => line.endsWith(' /protected.html')).length
  await page.goto(`${fixtures.hosts.ip}/embed.html`)
  const deadline = Date.now() + 10000
  while (fixtures.requests.filter(line => line.endsWith(' /protected.html')).length <= before) {
    if (Date.now() > deadline) throw new Error('the embedding page never requested the protected page')
    await sleep(100)
  }
  await sleep(1000)
  assert.equal(await page.title(), 'Embedder', 'the protected page must not render inside another site')
  await page.close()
})

test('an added site redirecting to an origin that was granted but not added is not de-protected', { timeout: 60000 }, async () => {
  // A feed on localhost grants that host, so the extension's header listener sees its responses,
  // but localhost is not an added site: isApprovedTarget() must keep its framing protection.
  await addFeeds(dashboard, `${fixtures.hosts.name}/other-host.rss`, { group: 'Other host' })
  const url = `${fixtures.hosts.ip}/later-redirects`
  await addSite(dashboard, url)
  await clickButton(dashboard, '.tabs', 'Monitor')
  await waitForMessage(message => message.plain === true)

  const target = `${fixtures.hosts.name}/protected.html`
  fixtures.routes['/later-redirects'] = () => ({ status: 302, headers: { location: target } })
  const { id } = (await storageGet(dashboard, 'hosts')).find(host => host.url === url)
  const before = fixtures.requests.filter(line => line.startsWith('localhost:') && line.endsWith(' /protected.html')).length
  await click(dashboard, `[data-tile-id="${id}"] button[aria-label="Refresh preview"]`)
  const deadline = Date.now() + 10000
  while (fixtures.requests.filter(line => line.startsWith('localhost:') && line.endsWith(' /protected.html')).length <= before) {
    if (Date.now() > deadline) throw new Error('the preview never followed the redirect')
    await sleep(100)
  }
  await sleep(1000)
  const framed = await dashboard.evaluate(address => window.e2eMessages.some(message => message.framed === address), target)
  assert.equal(framed, false, 'the redirect target must keep its framing protection')
})
