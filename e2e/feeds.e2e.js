// Feed groups and per-feed display settings, as the Feeds tab manages them and the Monitor wall
// shows them.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { choose, click, clickButton, fill, launchFirefox, startFixtureServer } from './harness.js'
import { addFeeds, openDashboard, resetExtension, storageGet, waitForStorage } from './flows.js'

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const DESCRIPTION = 'The quick brown fox jumps over the lazy dog'
const rss = (title, item, extra = '') => ({
  headers: { 'content-type': 'application/rss+xml' },
  body: `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://example.com/</link>
    <item><title>${item}</title><link>https://example.com/${item.replace(/\s/g, '-')}</link><guid>${item}</guid>
    <description>${DESCRIPTION}</description>${extra}</item></channel></rss>`
})

let firefox
let fixtures
let dashboard

before(async () => {
  fixtures = await startFixtureServer({
    '/news.html': ({ ip }) => ({
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: `<!doctype html><html><head><title>News</title>
        <link rel="alternate" type="application/rss+xml" title="Alpha" href="${ip}/alpha.rss">
        <link rel="alternate" type="application/rss+xml" title="Beta" href="${ip}/beta.rss">
        </head><body>News</body></html>`
    }),
    '/alpha.rss': ({ ip }) => rss('Alpha', 'Alpha one', `<enclosure url="${ip}/pixel.png" type="image/png" length="68"/>`),
    '/beta.rss': () => rss('Beta', 'Beta one'),
    '/pixel.png': () => ({ headers: { 'content-type': 'image/png' }, body: PIXEL })
  })
  firefox = await launchFirefox()
  await resetExtension(firefox.browser)
  dashboard = await openDashboard(firefox.browser)
})

after(async () => {
  await firefox?.browser.close()
  await fixtures?.close()
})

// What the Monitor wall shows for each feed group: name, feed count, item titles and the first
// item's description and image.
async function wall () {
  await clickButton(dashboard, '.tabs', 'Monitor')
  return dashboard.$$eval('.feed-items', lists => lists.map(list => {
    const card = list.closest('[data-tile-id]')
    return {
      name: card.querySelector('.card-host').textContent.trim(),
      count: card.querySelector('.feed-count').textContent.trim(),
      titles: [...card.querySelectorAll('.feed-item-title')].map(title => title.textContent.trim()).sort(),
      description: card.querySelector('.feed-item-description')?.textContent.trim() ?? null,
      image: !!card.querySelector('img.feed-item-image'),
      meta: card.querySelector('.feed-meta').textContent.replace(/\s+/g, ' ').trim()
    }
  }).sort((a, b) => a.name.localeCompare(b.name)))
}

async function waitForWall (predicate, timeout = 15000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await wall()
    if (predicate(last)) return last
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`the wall never matched; it shows ${JSON.stringify(last)}`)
}

// The Feeds tab's section for a group, found by the value of its name field (every section's
// "Move feed to group" menu lists all group names, so its text alone would match any of them).
function groupSection (name) {
  return marked('.feed-group-admin', name, (sections, wanted, marker) => {
    const section = sections.find(item => item.querySelector('.group-name-input')?.value === wanted)
    if (section) section.dataset.e2e = marker
    return !!section
  })
}

// The Feeds tab's row for a feed, found by its title.
function sourceRow (title) {
  return marked('.feed-source-row', title, (rows, wanted, marker) => {
    const row = rows.find(item => item.querySelector('.feed-source-name strong')?.textContent.trim().endsWith(wanted))
    if (row) row.dataset.e2e = marker
    return !!row
  })
}

async function marked (selector, value, find) {
  const marker = `e2e-${Math.random().toString(36).slice(2)}`
  if (!(await dashboard.$$eval(selector, find, value, marker))) throw new Error(`No ${selector} for "${value}"`)
  return `[data-e2e="${marker}"]`
}

test('two feeds added into one group show as one tile on the Monitor wall', { timeout: 60000 }, async () => {
  const { ip } = fixtures.hosts
  await addFeeds(dashboard, `${ip}/news.html`, { pick: [`${ip}/alpha.rss`, `${ip}/beta.rss`], group: 'News' })
  const tiles = await waitForWall(shown => shown.length === 1 && shown[0].titles.length === 2)
  assert.deepEqual(tiles.map(({ name, count, titles }) => ({ name, count, titles })),
    [{ name: 'News', count: '2 feeds', titles: ['Alpha one', 'Beta one'] }])
})

test('a feed moved to a new group and both groups renamed show up as two tiles', { timeout: 60000 }, async () => {
  await clickButton(dashboard, '.tabs', 'Feeds')
  await fill(dashboard, '.feed-admin > form.field input[aria-label="New group name"]', 'Other')
  await clickButton(dashboard, '.feed-admin > form.field', 'Create group')
  await waitForStorage(dashboard, 'feedGroups', groups => (groups || []).some(group => group.name === 'Other'))
  const other = (await storageGet(dashboard, 'feedGroups')).find(group => group.name === 'Other')

  const beta = await sourceRow('Beta')
  await choose(dashboard, `${beta} select[aria-label="Move feed to group"]`, other.id)
  await waitForStorage(dashboard, 'feedSources', (sources, id) =>
    sources.some(source => source.title === 'Beta' && source.groupId === id), other.id)

  for (const [from, to] of [['News', 'Headlines'], ['Other', 'Second']]) {
    const section = await groupSection(from)
    await fill(dashboard, `${section} .group-name-input`, to)
    await clickButton(dashboard, section, 'Rename')
    await waitForStorage(dashboard, 'feedGroups', (groups, name) => groups.some(group => group.name === name), to)
  }
  const tiles = await waitForWall(shown => shown.length === 2 && shown[0].name === 'Headlines')
  assert.deepEqual(tiles.map(({ name, count, titles }) => ({ name, count, titles })), [
    { name: 'Headlines', count: '1 feed', titles: ['Alpha one'] },
    { name: 'Second', count: '1 feed', titles: ['Beta one'] }
  ])
})

test("each feed's image, description and description limit apply to its tile", { timeout: 60000 }, async () => {
  let [alpha] = await waitForWall(shown => shown[0]?.image)
  assert.equal(alpha.description, DESCRIPTION)

  await clickButton(dashboard, '.tabs', 'Feeds')
  const row = await sourceRow('Alpha')
  const [image, description] = await dashboard.$$(`${row} fieldset input[type="checkbox"]`)
  await image.evaluate(element => { element.dataset.e2e = 'alpha-image' })
  await description.evaluate(element => { element.dataset.e2e = 'alpha-description' })

  await click(dashboard, '[data-e2e="alpha-image"]')
  alpha = (await waitForWall(shown => !shown[0].image))[0]
  assert.equal(alpha.description, DESCRIPTION, 'hiding the image leaves the description')

  await clickButton(dashboard, '.tabs', 'Feeds')
  await choose(dashboard, `${row} .limit-input`, 9)
  alpha = (await waitForWall(shown => shown[0].description !== DESCRIPTION))[0]
  assert.equal(alpha.description, 'The quick…')

  await clickButton(dashboard, '.tabs', 'Feeds')
  await choose(dashboard, `${row} .limit-input`, 0)
  alpha = (await waitForWall(shown => shown[0].description === DESCRIPTION))[0]
  assert.equal(alpha.description, DESCRIPTION, 'a limit of 0 shows the whole description')

  await clickButton(dashboard, '.tabs', 'Feeds')
  await click(dashboard, '[data-e2e="alpha-description"]')
  alpha = (await waitForWall(shown => shown[0].description === null))[0]
  assert.deepEqual(alpha.titles, ['Alpha one'])
  await clickButton(dashboard, '.tabs', 'Feeds')
  assert.equal(await dashboard.$eval(`${row} .limit-input`, input => input.disabled), true,
    'the limit is disabled while the description is hidden')
})

test('a failing feed keeps its cached headlines on refresh', { timeout: 60000 }, async () => {
  fixtures.routes['/beta.rss'] = () => ({ status: 500 })
  const second = (await storageGet(dashboard, 'feedGroups')).find(group => group.name === 'Second')
  await clickButton(dashboard, '.tabs', 'Monitor')
  await click(dashboard, `[data-tile-id="${second.id}"] button[aria-label="Refresh feeds"]`)
  const tiles = await waitForWall(shown => shown[1]?.meta.includes('1 failed'))
  assert.deepEqual(tiles[1].titles, ['Beta one'])
})

test('a feed URL entered directly is offered as a feed, not as a website', { timeout: 60000 }, async () => {
  await clickButton(dashboard, '.tabs', 'Feeds')
  const form = '.feed-admin form.add-form'
  await fill(dashboard, `${form} input[aria-label="Site, page, or feed URL"]`, `${fixtures.hosts.ip}/alpha.rss`)
  await click(dashboard, `${form} button[type="submit"]`)
  await dashboard.waitForSelector(`${form} .add-review`, { timeout: 15000 })
  const review = await dashboard.$eval(`${form} .add-review`, element => element.textContent.replace(/\s+/g, ' '))
  assert.match(review, /Feed detected/)
  assert.ok(!(await dashboard.$(`${form} .add-options`)), 'no Website/Feed/Both choice for a direct feed')
  assert.ok(await dashboard.$$eval(`${form} button`, buttons => buttons.some(button => button.textContent.trim() === 'Add feed')))
  await clickButton(dashboard, form, 'Cancel')
  await dashboard.waitForFunction(selector => !document.querySelector(`${selector} .add-review`), {}, form)
})
