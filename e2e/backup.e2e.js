// Export and import: a backup made through Settings restores everything after a reset, through
// the one permission request that the "Grant & import" click allows.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { choose, click, clickButton, fill, launchFirefox, setFile, startFixtureServer } from './harness.js'
import { addFeeds, addSite, openDashboard, resetExtension, storageGet, waitForStorage } from './flows.js'

const rss = (title, items) => ({
  headers: { 'content-type': 'application/rss+xml' },
  body: `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://example.com/</link>
    ${items.map(item => `<item><title>${item}</title><link>https://example.com/${item.replace(/\s/g, '-')}</link><guid>${item}</guid></item>`).join('')}
    </channel></rss>`
})
const html = body => ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let firefox
let fixtures
let downloads
let dashboard

before(async () => {
  fixtures = await startFixtureServer({
    '/site.html': () => html('<!doctype html><title>Site</title>'),
    '/news.html': ({ name }) => html(`<!doctype html><html><head><title>News</title>
      <link rel="alternate" type="application/rss+xml" title="Alpha" href="${name}/alpha.rss"></head></html>`),
    '/alpha.rss': () => rss('Alpha', ['Alpha one', 'Alpha two'])
  })
  downloads = await mkdtemp(join(tmpdir(), 'glanceboard-e2e-'))
  firefox = await launchFirefox({ downloadDir: downloads })
  await resetExtension(firefox.browser)
  dashboard = await openDashboard(firefox.browser)
})

after(async () => {
  await firefox?.browser.close()
  await fixtures?.close()
  if (downloads) await rm(downloads, { recursive: true, force: true })
})

// Everything a backup is meant to carry, keyed by URL rather than by the ids storage assigns.
async function snapshot (page) {
  return page.evaluate(async () => {
    const all = await browser.storage.local.get(null)
    const groups = all.feedGroups || []
    const groupName = id => groups.find(group => group.id === id)?.name
    const sources = (all.feedSources || []).map(source => ({
      url: source.url, type: source.type, group: groupName(source.groupId), refresh: source.refresh,
      read: (all[`feed-read:${source.id}`]?.items || []).map(item => item.id).sort()
    }))
    return {
      sites: (all.hosts || []).map(host => host.url).sort(),
      groups: groups.map(group => ({ name: group.name, itemFilter: group.itemFilter })).sort((a, b) => a.name.localeCompare(b.name)),
      sources,
      readLater: (all.readLater || []).map(item => item.title).sort(),
      origins: (await browser.permissions.getAll()).origins.sort()
    }
  })
}

async function waitForDownload (path, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, 'utf8')) } catch { await sleep(200) }
  }
  throw new Error(`no download at ${path}`)
}

// Pick a file in Settings → Import and confirm with the real click the permission request needs.
async function importFile (page, contents) {
  await clickButton(page, '.tabs', 'Settings')
  await setFile(page, '.settings input[type="file"]', 'backup.json', contents)
  const id = await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('.settings button')].find(item => item.textContent.trim().startsWith('Grant & import'))
    if (button) button.dataset.e2e = 'grant-import'
    return !!button || [...document.querySelectorAll('.settings .error-text')].some(item => item.textContent.trim())
  }, { timeout: 10000 }).then(() => page.$('[data-e2e="grant-import"]'))
  if (id) await click(page, '[data-e2e="grant-import"]')
}

function settingsMessages (page) {
  return page.$$eval('.settings .error-text, .settings .popup-load', items =>
    items.map(item => item.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean))
}

test('a backup restores sites, feeds, empty groups, polling, filters, Read Later and read markers after a reset', { timeout: 120000 }, async () => {
  const { ip } = fixtures.hosts
  await addSite(dashboard, `${ip}/site.html`)
  await addFeeds(dashboard, `${ip}/news.html`, { group: 'News' })

  // An empty group, a fixed polling interval, a saved item, a read marker and a group filter.
  await fill(dashboard, '.feed-admin > form.field input[aria-label="New group name"]', 'Empty')
  await clickButton(dashboard, '.feed-admin > form.field', 'Create group')
  await waitForStorage(dashboard, 'feedGroups', groups => groups.some(group => group.name === 'Empty'))
  await choose(dashboard, '.feed-source-row .refresh-select', 'fixed:60')
  await waitForStorage(dashboard, 'feedSources', sources => sources[0].refresh?.mode === 'fixed')

  await clickButton(dashboard, '.tabs', 'Monitor')
  await dashboard.waitForFunction(() => document.querySelectorAll('.feed-item').length === 2, { timeout: 15000 })
  await click(dashboard, '.feed-item:nth-child(1) button[aria-label="Save to Read Later"]')
  await waitForStorage(dashboard, 'readLater', items => (items || []).length === 1)
  await click(dashboard, '.feed-item:nth-child(1) button[aria-label="Mark as read"]')
  const source = (await storageGet(dashboard, 'feedSources'))[0]
  await waitForStorage(dashboard, `feed-read:${source.id}`, state => (state?.items || []).length === 1)
  await click(dashboard, 'button.feed-filter')
  await waitForStorage(dashboard, 'feedGroups', groups => groups.find(group => group.name === 'News').itemFilter !== 'unread')

  const before = await snapshot(dashboard)
  assert.deepEqual(before.origins, ['http://127.0.0.1/*', 'http://localhost/*'])

  await clickButton(dashboard, '.tabs', 'Settings')
  await clickButton(dashboard, '.settings', 'Export')
  const backup = await waitForDownload(join(downloads, 'glanceboard-data.json'))
  assert.equal(backup.sites?.length ?? backup.hosts?.length, 1)

  await dashboard.close()
  await resetExtension(firefox.browser)
  dashboard = await openDashboard(firefox.browser)
  assert.deepEqual((await snapshot(dashboard)).sites, [])

  await importFile(dashboard, JSON.stringify(backup))
  await dashboard.waitForFunction(() => document.querySelector('.settings')?.textContent.includes('Imported'), { timeout: 20000 })
    .catch(async error => { throw new Error(`no import notice: ${await settingsMessages(dashboard)}`, { cause: error }) })
  await waitForStorage(dashboard, 'feedSources', sources => (sources || []).length === 1)
  const restored = await snapshot(dashboard)
  assert.deepEqual(restored, before)
})

test('an older { "hosts": [...] } file imports its sites', { timeout: 60000 }, async () => {
  await dashboard.close()
  await resetExtension(firefox.browser)
  dashboard = await openDashboard(firefox.browser)
  const url = `${fixtures.hosts.ip}/site.html`
  await importFile(dashboard, JSON.stringify({ hosts: [{ url }] }))
  await waitForStorage(dashboard, 'hosts', (hosts, target) => (hosts || []).some(host => host.url === target), url)
})

test('a file that is not JSON, or has nothing valid in it, is refused with a message', { timeout: 60000 }, async () => {
  await importFile(dashboard, 'not json at all')
  assert.ok((await settingsMessages(dashboard)).includes('Invalid JSON file'))

  await importFile(dashboard, JSON.stringify({ hosts: ['not a url ://'] }))
  await dashboard.waitForFunction(() => document.querySelector('.settings')?.textContent.includes('No valid sites'), { timeout: 10000 })
})
