// App-level steps shared by the browser tests, built on the input helpers in harness.js. Every step
// goes through the UI the way a user does; storage is read to know when a step has finished.
import { choose, click, clickButton, fill, openExtensionPage } from './harness.js'

// Forget everything a previous test left: storage and the granted host permissions. The layout is
// pinned to desktop so previews load on their own instead of on scroll.
export async function resetExtension (browser) {
  const page = await openExtensionPage(browser, 'dashboard.html')
  await page.evaluate(async () => {
    const { origins } = await browser.permissions.getAll()
    if (origins.length) await browser.permissions.remove({ origins })
    await browser.storage.local.clear()
    await browser.storage.local.set({ seeded: true, settings: { mode: 'desktop' } })
  })
  await page.close()
}

// Open the dashboard on one of its tabs: Monitor, Sites, Feeds, Read Later or Settings.
export async function openDashboard (browser, tab = 'Monitor') {
  const page = await openExtensionPage(browser, 'dashboard.html')
  await page.waitForSelector('.tabs button')
  if (tab !== 'Monitor') await clickButton(page, '.tabs', tab)
  return page
}

export function storageGet (page, key) {
  return page.evaluate(async name => (await browser.storage.local.get(name))[name], key)
}

// Wait until `predicate(stored value of key, arg)` holds. The predicate runs in the page; it is
// passed as source because the extension's CSP forbids building functions from strings there.
export async function waitForStorage (page, key, predicate, arg, timeout = 15000) {
  const name = JSON.stringify(key)
  await page.waitForFunction(
    `(async () => (${predicate})((await browser.storage.local.get(${name}))[${name}], ${JSON.stringify(arg)}))()`,
    { timeout }
  )
}

// Add a site through the Sites tab's form. Its host must offer no feed — neither advertised nor at
// a conventional path such as /feed.xml (COMMON_FEED_PATHS) — or a review opens instead.
export async function addSite (page, url) {
  await clickButton(page, '.tabs', 'Sites')
  const form = await visibleAddForm(page)
  await fill(page, `${form} input[aria-label="Site, page, or feed URL"]`, url)
  await click(page, `${form} button[type="submit"]`)
  await waitForStorage(page, 'hosts', (hosts, target) => (hosts || []).some(host => host.url === target), url)
}

// Add feeds advertised by `pageUrl` (or the feed at `pageUrl` itself) through the Feeds tab: `pick`
// lists the feed URLs to select, `group` is a new group's name or an existing group's id.
export async function addFeeds (page, pageUrl, { pick, group = 'News', choice = 'feed' } = {}) {
  await clickButton(page, '.tabs', 'Feeds')
  const form = '.feed-admin form.add-form'
  await fill(page, `${form} input[aria-label="Site, page, or feed URL"]`, pageUrl)
  await click(page, `${form} button[type="submit"]`)
  await page.waitForSelector(`${form} .add-review`, { timeout: 15000 })
  const direct = await page.$eval(`${form} .add-review`, element => element.textContent.includes('Feed detected'))
  if (!direct) await click(page, `${form} .add-options input[value="${choice}"]`)
  if (pick) {
    await page.$$eval(`${form} .feed-choice input[type="checkbox"]`, (boxes, wanted) => {
      for (const box of boxes) box.dataset.e2eWanted = String(wanted.includes(box.value))
    }, pick)
    for (const box of await page.$$(`${form} .feed-choice input[type="checkbox"]`)) {
      const { wanted, checked, value } = await box.evaluate(element =>
        ({ wanted: element.dataset.e2eWanted === 'true', checked: element.checked, value: element.value }))
      if (wanted !== checked) await click(page, `${form} .feed-choice input[value="${value}"]`)
    }
  }
  const groups = await storageGet(page, 'feedGroups') || []
  const existing = groups.find(item => item.id === group)
  if (existing) {
    await choose(page, `${form} select`, existing.id)
  } else {
    await choose(page, `${form} select`, '__new__')
    await fill(page, `${form} input[aria-label="New group name"]`, group)
  }
  await clickButton(page, form, direct ? 'Add feed' : 'Add selection')
  await page.waitForFunction(selector => !document.querySelector(`${selector} .add-review`), { timeout: 20000 }, form)
    .catch(async error => {
      const shown = await page.$eval(form, element => element.textContent.replace(/\s+/g, ' ').trim())
      throw new Error(`the feeds were not added; the form shows: ${shown}`, { cause: error })
    })
}

// The add form on the tab that is showing.
async function visibleAddForm (page) {
  const id = await page.$$eval('form.add-form', forms => {
    for (const item of forms) delete item.dataset.e2eForm
    const form = forms.find(item => item.offsetParent !== null)
    if (!form) return null
    form.dataset.e2eForm = 'visible'
    return 'visible'
  })
  if (!id) throw new Error('No visible add form')
  return 'form.add-form[data-e2e-form="visible"]'
}
