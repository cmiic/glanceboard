import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXTENSION_BASE, EXTENSION_ID, click, fill, launchFirefox, openExtensionPage, startFixtureServer
} from './harness.js'

const rss = channel => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>${channel}</title><link>https://example.com/</link>
<item><title>First fixture item</title><link>https://example.com/first</link><guid>first</guid></item>
</channel></rss>`

let firefox
let fixtures

before(async () => {
  fixtures = await startFixtureServer({
    // A page on one host advertising a feed on the other, so adding it needs a second, cross-origin
    // permission grant from the confirmation click (the #40 flow).
    '/page.html': ({ name }) => ({
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: `<!doctype html><html><head><title>Fixture page</title>
        <link rel="alternate" type="application/rss+xml" title="Fixture feed" href="${name}/feed.xml">
        </head><body>Fixture page</body></html>`
    }),
    '/feed.xml': () => ({ headers: { 'content-type': 'application/rss+xml' }, body: rss('Fixture feed') })
  })
  firefox = await launchFirefox()
})

after(async () => {
  await firefox?.browser.close()
  await fixtures?.close()
})

test('the built extension installs and its dashboard opens at the pinned address', { timeout: 30000 }, async () => {
  assert.equal(firefox.id, EXTENSION_ID)
  const page = await openExtensionPage(firefox.browser, 'dashboard.html')
  assert.equal(await page.evaluate(() => location.href), `${EXTENSION_BASE}/dashboard.html`)
  assert.equal(await page.$eval('h1', element => element.textContent.trim()), 'Glanceboard')
  await page.close()
})

test('permissions.request() needs a click, and fails after an await inside the handler', { timeout: 30000 }, async () => {
  // This is what makes the add-flow test below meaningful: with prompts off, Firefox still enforces
  // the user-gesture rule, so a handler that awaits before requesting — the #40 bug — still fails.
  const page = await openExtensionPage(firefox.browser, 'dashboard.html')
  await page.evaluate(() => {
    const settle = key => [value => { window[key] = value }, error => { window[key] = `error: ${error.message}` }]
    const first = document.createElement('button')
    first.id = 'request-first'
    first.onclick = () => browser.permissions.request({ origins: ['http://first.invalid/*'] }).then(...settle('requestFirst'))
    const late = document.createElement('button')
    late.id = 'request-late'
    late.onclick = async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
      browser.permissions.request({ origins: ['http://late.invalid/*'] }).then(...settle('requestLate'))
    }
    first.textContent = 'first'
    late.textContent = 'late'
    document.body.prepend(first, late)
  })
  const withoutClick = await page.evaluate(() =>
    browser.permissions.request({ origins: ['http://unclicked.invalid/*'] }).then(String, error => `error: ${error.message}`))
  assert.match(withoutClick, /user input handler/)

  await click(page, '#request-first')
  await click(page, '#request-late')
  await page.waitForFunction(() => 'requestFirst' in window && 'requestLate' in window, { timeout: 10000 })
  assert.equal(await page.evaluate(() => window.requestFirst), true)
  assert.match(await page.evaluate(() => window.requestLate), /user input handler/)
  const { origins } = await page.evaluate(() => browser.permissions.getAll())
  assert.ok(origins.includes('http://first.invalid/*'))
  assert.ok(!origins.includes('http://late.invalid/*'))
  assert.ok(!origins.includes('http://unclicked.invalid/*'))
  await page.close()
})

test('adding a feed advertised on another host: each click grants its host, and the feed is added', { timeout: 60000 }, async () => {
  const page = await openExtensionPage(firefox.browser, 'dashboard.html')
  await click(page, 'button.tab:nth-of-type(3)') // Monitor, Sites, Feeds
  const form = '.feed-admin form.add-form'
  await fill(page, `${form} input[aria-label="Site, page, or feed URL"]`, `${fixtures.hosts.ip}/page.html`)
  await click(page, `${form} button[type="submit"]`)

  await page.waitForFunction(selector => document.querySelector(`${selector} .add-review`)?.textContent.includes('Feeds available'),
    { timeout: 15000 }, form)
  await click(page, `${form} .add-options input[value="feed"]`)
  await page.waitForFunction(selector => [...document.querySelectorAll(`${selector} button`)]
    .some(button => button.textContent.trim() === 'Add selection'), { timeout: 5000 }, form)
  await page.$$eval(`${form} button`, buttons => {
    buttons.find(button => button.textContent.trim() === 'Add selection').id = 'confirm-selection'
  })
  await click(page, '#confirm-selection')

  const feedUrl = `${fixtures.hosts.name}/feed.xml`
  await page.waitForFunction(async url => {
    const { feedSources = [] } = await browser.storage.local.get('feedSources')
    return feedSources.some(source => source.url === url)
  }, { timeout: 20000 }, feedUrl).catch(async error => {
    const shown = await page.$eval(form, element => element.textContent.replace(/\s+/g, ' ').trim())
    throw new Error(`the feed was not added; the form shows: ${shown}`, { cause: error })
  })
  // Only the feed was chosen, so the page host was a discovery-only grant: it is revoked when the add
  // flow ends (SECURITY.md, "Permissions"), while the feed host stays granted for the saved feed.
  await page.waitForFunction(async () => {
    const { origins } = await browser.permissions.getAll()
    return !origins.includes('http://127.0.0.1/*')
  }, { timeout: 10000 })
  const { origins } = await page.evaluate(() => browser.permissions.getAll())
  assert.ok(origins.includes('http://localhost/*'), 'the Add selection click granted the feed host')
  await page.close()
})
