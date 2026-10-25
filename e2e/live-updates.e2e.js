// Live updates: what one extension page changes shows up in an open dashboard without a reload,
// through storage.onChanged.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { click, clickButton, launchFirefox, startFixtureServer } from './harness.js'
import { addFeeds, addSite, openDashboard, resetExtension, storageGet } from './flows.js'

const html = body => ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body })

let firefox
let fixtures
let watcher
let editor

before(async () => {
  fixtures = await startFixtureServer({
    '/site.html': () => html('<!doctype html><title>Site</title>'),
    '/news.html': ({ ip }) => html(`<!doctype html><html><head><title>News</title>
      <link rel="alternate" type="application/rss+xml" title="Alpha" href="${ip}/alpha.rss"></head></html>`),
    '/alpha.rss': () => ({
      headers: { 'content-type': 'application/rss+xml' },
      body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Alpha</title>
        <item><title>Alpha one</title><guid>one</guid></item><item><title>Alpha two</title><guid>two</guid></item>
        </channel></rss>`
    })
  })
  firefox = await launchFirefox()
  await resetExtension(firefox.browser)
  // `watcher` only looks; every change is made in `editor`, another dashboard tab.
  watcher = await openDashboard(firefox.browser)
  editor = await openDashboard(firefox.browser)
})

after(async () => {
  await firefox?.browser.close()
  await fixtures?.close()
})

async function waitFor (page, description, predicate, arg, timeout = 15000) {
  await page.waitForFunction(predicate, { timeout }, arg).catch(async error => {
    const shown = await page.$eval('body', body => body.textContent.replace(/\s+/g, ' ').slice(0, 400))
    throw new Error(`${description}; the page shows: ${shown}`, { cause: error })
  })
}

test('a site added in another tab appears on the open dashboard', { timeout: 60000 }, async () => {
  await addSite(editor, `${fixtures.hosts.ip}/site.html`)
  await clickButton(watcher, '.tabs', 'Sites')
  await waitFor(watcher, 'the watcher never listed the site',
    () => document.querySelectorAll('.host-row').length === 1 && document.body.textContent.includes('1 sites'))
})

test("a site's new check result turns its status dot on the open dashboard", { timeout: 60000 }, async () => {
  const [host] = await storageGet(editor, 'hosts')
  const write = (ok) => editor.evaluate(async (id, fine) => {
    await browser.storage.local.set({
      [`result:${id}`]: {
        timestamp: [Date.now()], elapsed: [120], certExpiresInDays: [null],
        ok: fine, error: fine ? null : 'Connection refused', source: 'fetch', lastTimestamp: Date.now()
      }
    })
  }, host.id, ok)
  await write(false)
  await waitFor(watcher, 'the dot never turned bad', () => !!document.querySelector('.host-row .dot.bad'))
  await write(true)
  await waitFor(watcher, 'the dot never turned ok', () => !!document.querySelector('.host-row .dot.ok'))
})

test("a feed's refreshed cache shows its new item on the open dashboard", { timeout: 60000 }, async () => {
  await addFeeds(editor, `${fixtures.hosts.ip}/news.html`, { group: 'News' })
  await clickButton(watcher, '.tabs', 'Monitor')
  await waitFor(watcher, 'the feed tile never appeared', () => document.querySelectorAll('.feed-item').length === 2)

  const [source] = await storageGet(editor, 'feedSources')
  await editor.evaluate(async id => {
    const key = `feed-cache:${id}`
    const { [key]: cache } = await browser.storage.local.get(key)
    const fresh = { id: 'three', title: 'Alpha three', url: null, publishedAt: Date.now(), description: '', imageUrl: null, audio: null }
    await browser.storage.local.set({ [key]: { ...cache, items: [fresh, ...cache.items] } })
  }, source.id)
  await waitFor(watcher, 'the new item never appeared',
    () => [...document.querySelectorAll('.feed-item-title')].some(title => title.textContent.trim() === 'Alpha three'))
})

test('an item marked read in one dashboard leaves the Unread view of the other', { timeout: 60000 }, async () => {
  await clickButton(editor, '.tabs', 'Monitor')
  await waitFor(editor, 'the editor never showed three items', () => document.querySelectorAll('.feed-item').length === 3)
  const title = await editor.$eval('.feed-item:nth-child(1) .feed-item-title', element => element.textContent.trim())
  await click(editor, '.feed-item:nth-child(1) button[aria-label="Mark as read"]')
  await waitFor(watcher, 'the read item stayed in the other tab', text =>
    document.querySelectorAll('.feed-item').length === 2 &&
    ![...document.querySelectorAll('.feed-item-title')].some(element => element.textContent.trim() === text), title)
  assert.equal(await watcher.$eval('button.feed-filter', button => button.getAttribute('aria-label').startsWith('Showing unread')), true)
})
