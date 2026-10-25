// Keyboard access, with real key presses: the popup's rows, the mobile preview overlay and the
// Settings labels.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { choose, click, clickButton, launchFirefox, openExtensionPage, press, startFixtureServer, tabUrls } from './harness.js'
import { addFeeds, addSite, openDashboard, resetExtension } from './flows.js'

const html = body => ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let firefox
let fixtures
let sites

before(async () => {
  fixtures = await startFixtureServer({
    '/first.html': () => html('<!doctype html><title>First</title>'),
    '/second.html': () => html('<!doctype html><title>Second</title>'),
    '/news.html': ({ ip }) => html(`<!doctype html><html><head><title>News</title>
      <link rel="alternate" type="application/rss+xml" title="Alpha" href="${ip}/alpha.rss"></head></html>`),
    '/alpha.rss': () => ({
      headers: { 'content-type': 'application/rss+xml' },
      body: '<?xml version="1.0"?><rss version="2.0"><channel><title>Alpha</title><item><title>One</title><guid>one</guid></item></channel></rss>'
    })
  })
  sites = [`${fixtures.hosts.ip}/first.html`, `${fixtures.hosts.ip}/second.html`]
  firefox = await launchFirefox()
  await resetExtension(firefox.browser)
  const dashboard = await openDashboard(firefox.browser)
  for (const url of sites) await addSite(dashboard, url)
  await addFeeds(dashboard, `${fixtures.hosts.ip}/news.html`, { group: 'News' })
  await dashboard.close()
})

after(async () => {
  await firefox?.browser.close()
  await fixtures?.close()
})

const focused = page => page.evaluate(() => {
  const element = document.activeElement
  if (!element || element === document.body) return null
  return element.classList.contains('host-row') ? `row: ${element.querySelector('.name').textContent.trim()}` : element.tagName.toLowerCase()
})

async function waitForTab (page, matches, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const urls = await tabUrls(page)
    if (urls.some(matches)) return urls
    await sleep(100)
  }
  throw new Error(`no matching tab; open tabs: ${(await tabUrls(page)).join(', ')}`)
}

test('Tab reaches every popup row in order, and Enter opens a site', { timeout: 60000 }, async () => {
  const popup = await openExtensionPage(firefox.browser, 'popup.html')
  await popup.waitForFunction(() => document.querySelectorAll('.host-row').length === 3, { timeout: 10000 })
  const order = []
  for (let i = 0; i < 8 && order.filter(item => item?.startsWith('row:')).length < 3; i++) {
    await press(popup, 'Tab')
    order.push(await focused(popup))
  }
  assert.deepEqual(order.filter(item => item?.startsWith('row:')),
    ['row: 127.0.0.1/first.html', 'row: 127.0.0.1/second.html', 'row: News'])

  await popup.$$eval('.host-row', rows => rows[1].focus())
  await press(popup, 'Enter')
  await waitForTab(popup, url => url === sites[1])
  await popup.close()
})

test('Space on a popup feed-group row opens the dashboard', { timeout: 60000 }, async () => {
  const popup = await openExtensionPage(firefox.browser, 'popup.html')
  await popup.waitForFunction(() => document.querySelectorAll('.host-row').length === 3, { timeout: 10000 })
  // The popup closes itself after opening the dashboard, so watch the tabs from another page.
  const observer = await openExtensionPage(firefox.browser, 'popup.html')
  const dashboards = (await tabUrls(observer)).filter(url => url.endsWith('/dashboard.html')).length
  await popup.$$eval('.host-row', rows => rows[2].focus())
  await press(popup, ' ')
  const deadline = Date.now() + 10000
  while ((await tabUrls(observer)).filter(url => url.endsWith('/dashboard.html')).length <= dashboards) {
    if (Date.now() > deadline) throw new Error(`Space did not open the dashboard; tabs: ${(await tabUrls(observer)).join(', ')}; popup focus: ${await focused(popup).catch(error => error.message)}`)
    await sleep(100)
  }
  await observer.close()
})

test('in the mobile layout, Enter on a preview overlay opens its site', { timeout: 60000 }, async () => {
  const dashboard = await openDashboard(firefox.browser, 'Settings')
  await choose(dashboard, '#settings-layout', 'mobile')
  await clickButton(dashboard, '.tabs', 'Monitor')
  await dashboard.waitForSelector('.preview button.overlay', { timeout: 10000 })
  await dashboard.$$eval('.preview button.overlay', overlays => overlays[0].focus())
  const before = (await tabUrls(dashboard)).filter(url => url.startsWith(fixtures.hosts.ip)).length
  await press(dashboard, 'Enter')
  const deadline = Date.now() + 10000
  while ((await tabUrls(dashboard)).filter(url => url.startsWith(fixtures.hosts.ip)).length <= before) {
    if (Date.now() > deadline) throw new Error('Enter on the overlay did not open the site')
    await sleep(100)
  }
  await choose(dashboard, '#settings-layout', 'desktop')
  await dashboard.close()
})

test('clicking a Settings label focuses its control', { timeout: 60000 }, async () => {
  const dashboard = await openDashboard(firefox.browser, 'Settings')
  for (const id of ['settings-check-interval', 'settings-preview-interval', 'settings-card-width', 'settings-layout']) {
    await click(dashboard, `label[for="${id}"]`)
    await dashboard.waitForFunction(control => document.activeElement?.id === control, { timeout: 5000 }, id)
      .catch(async () => assert.fail(`label for ${id} focused ${await dashboard.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`))
  }
  await dashboard.close()
})
