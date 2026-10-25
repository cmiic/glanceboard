// Browser tests drive a real Firefox with the built extension installed. They need Firefox 142 or
// newer — the manifest's strict_min_version; WebDriver BiDi `webExtension.install` itself arrived in
// 137 — and a build in .output/firefox-mv2, which `npm run test:e2e` makes first. See TESTING.md,
// "Browser tests (Firefox, local)".
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

export const EXTENSION_ID = 'glanceboard@miic.at'
// Firefox gives every install a random moz-extension:// UUID. Pinning it in the profile gives the
// extension's pages a known address.
const EXTENSION_UUID = '7f3e9a52-2b1c-4d6e-8f0a-5c4b3a291d80'
export const EXTENSION_BASE = `moz-extension://${EXTENSION_UUID}`
const BUILD_DIR = fileURLToPath(new URL('../.output/firefox-mv2', import.meta.url))

function firefoxPath () {
  if (process.env.FIREFOX_BIN) return process.env.FIREFOX_BIN
  try {
    return execFileSync('which', ['firefox'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('Firefox not found on PATH; install it or set FIREFOX_BIN')
  }
}

export async function launchFirefox ({ downloadDir = null } = {}) {
  if (!existsSync(`${BUILD_DIR}/manifest.json`)) {
    throw new Error('No build in .output/firefox-mv2; `npm run test:e2e` builds before testing')
  }
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: firefoxPath(),
    headless: !process.env.E2E_HEADFUL,
    // WebDriver BiDi only navigates to http(s), file and blob URLs unless system access is allowed;
    // the extension's own pages are moz-extension:// URLs. This applies to the test's throwaway
    // Firefox only.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    extraPrefsFirefox: {
      // Grant optional permissions without the doorhanger. permissions.request() still requires a
      // user gesture (its schema sets requireUserInput), so it only succeeds from a real click.
      'extensions.webextOptionalPermissionPrompts': false,
      'extensions.webextensions.uuids': JSON.stringify({ [EXTENSION_ID]: EXTENSION_UUID }),
      // Downloads (the backup export) land in `downloadDir` without asking.
      ...(downloadDir && {
        'browser.download.dir': downloadDir,
        'browser.download.folderList': 2,
        'browser.download.useDownloadDir': true,
        'browser.download.always_ask_before_handling_new_types': false
      })
    }
  })
  try {
    const id = await browser.installExtension(BUILD_DIR)
    return { browser, id }
  } catch (error) {
    await browser.close()
    throw error
  }
}

// Firefox does not report navigation events for moz-extension:// pages over BiDi, so page.goto()
// would never settle: start the navigation without a timeout, then wait for the page itself. The
// hash makes each page's URL unique, so click() and press() find its tab even when the extension
// itself opens another tab on the same page (the popup's "Open dashboard").
let pageCount = 0
export async function openExtensionPage (browser, path) {
  const page = await browser.newPage()
  const url = `${EXTENSION_BASE}/${path}#e2e-${++pageCount}`
  page.goto(url, { timeout: 0 }).catch(() => {})
  await page.waitForFunction(
    expected => location.href === expected && document.readyState === 'complete',
    { timeout: 10000 },
    url
  )
  return page
}

// Run a function in the browser window (the parent process, reachable with system access), with the
// tab showing `page` selected. Returns the function's result.
async function inBrowserWindow (page, fn, ...args) {
  const url = await page.evaluate(() => location.href)
  const connection = page.browser().connection
  const { result: { contexts } } = await connection.send('browsingContext.getTree', { 'moz:scope': 'chrome' })
  const { result } = await connection.send('script.callFunction', {
    target: { context: contexts[0].context },
    functionDeclaration: `function (url, ...args) {
      const tabBrowser = window.gBrowser
      const browserElement = tabBrowser.browsers.find(item => item.currentURI.spec === url)
      if (!browserElement) throw new Error('No tab shows ' + url)
      const before = tabBrowser.selectedBrowser
      tabBrowser.selectedTab = tabBrowser.getTabForBrowser(browserElement)
      window.e2eSwitchedFrom = before === browserElement ? null : before
      return (${fn})(browserElement, ...args)
    }`,
    arguments: [url, ...args].map(value => typeof value === 'number' ? { type: 'number', value } : { type: 'string', value }),
    awaitPromise: false
  })
  if (result.type === 'exception') throw new Error(result.exceptionDetails.text)
  return result.result.value
}

// Select the page's tab before input goes to it. Selecting a tab lays it out and restores the focus
// inside it asynchronously, so input sent right after a switch can miss its target: when the tab
// was not selected yet, let the switch settle first.
async function activate (page) {
  const switched = await inBrowserWindow(page, function () {
    return window.e2eSwitchedFrom != null
  })
  if (switched) await new Promise(resolve => setTimeout(resolve, 250))
}

// Click an element the way real mouse input arrives. WebDriver refuses to send input into
// extension pages: Firefox counts them as privileged, and both BiDi's input.performActions and
// Marionette reject privileged contexts. So the mouse events are synthesized in the browser window
// at the element's position, and Firefox routes them into the page as trusted input — a user
// gesture, which permissions.request() needs.
export async function click (page, selector) {
  await activate(page)
  const target = await page.$eval(selector, element => {
    element.scrollIntoView({ block: 'center' })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  await inBrowserWindow(page, function (browserElement, x, y) {
    const rect = browserElement.getBoundingClientRect()
    for (const type of ['mousedown', 'mouseup']) {
      window.synthesizeMouseEvent(type, rect.left + x, rect.top + y, { button: 0, clickCount: 1 })
    }
  }, target.x, target.y)
}

// Click the button inside `scope` whose text is `text`.
export async function clickButton (page, scope, text) {
  const id = `e2e-button-${Math.random().toString(36).slice(2)}`
  const found = await page.$$eval(`${scope} button`, (buttons, label, marker) => {
    const button = buttons.find(item => item.textContent.trim() === label && item.offsetParent !== null)
    if (button) button.dataset.e2e = marker
    return !!button
  }, text, id)
  if (!found) throw new Error(`No visible button "${text}" in ${scope}`)
  await click(page, `[data-e2e="${id}"]`)
}

// Press a key the way real keyboard input arrives: through the browser window's text input
// processor, which Firefox's own EventUtils.synthesizeKey uses, to the focused element of the page.
// Enter and Space on a button count as a user gesture, like a click.
const KEYS = { Tab: 9, Enter: 13, ' ': 32, Escape: 27, ArrowDown: 40, ArrowUp: 38 }
export async function press (page, key) {
  await activate(page)
  await inBrowserWindow(page, function (browserElement, key, code, keyCode) {
    browserElement.focus()
    const { classes, interfaces } = window.Components
    const processor = classes['@mozilla.org/text-input-processor;1']
      .createInstance(interfaces.nsITextInputProcessor)
    if (!processor.beginInputTransactionForTests(window)) throw new Error('No input transaction')
    const event = new window.KeyboardEvent('', { key, code, keyCode })
    processor.keydown(event)
    processor.keyup(event)
  }, key, key === ' ' ? 'Space' : key, KEYS[key] || 0)
}

// The URLs of all open tabs.
export async function tabUrls (page) {
  return JSON.parse(await inBrowserWindow(page, function () {
    return JSON.stringify(window.gBrowser.browsers.map(item => item.currentURI.spec))
  }))
}

// Set a text field the way v-model listens for it. Typing needs no user gesture, so this sets the
// value and fires `input` rather than sending one key at a time.
export async function fill (page, selector, value) {
  await page.$eval(selector, (element, text) => {
    element.value = text
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

// Pick a <select> option (or set a number field) and fire `change`, as the @change handlers expect.
export async function choose (page, selector, value) {
  await page.$eval(selector, (element, text) => {
    element.value = text
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, String(value))
}

// Put a file on an <input type="file">. Only a DataTransfer can set `files`; then fire `change`.
export async function setFile (page, selector, name, contents) {
  await page.$eval(selector, (element, fileName, text) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([text], fileName, { type: 'application/json' }))
    element.files = transfer.files
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, name, contents)
}

// A loopback HTTP server for fixture pages and feeds. `routes` maps a path to a function of the
// server's base URLs, so a page on one host can point at the other: http://127.0.0.1:<port> and
// http://localhost:<port> are different hosts to the extension's per-host permissions. Routes are
// looked up per request, so a test can replace one (`fixtures.routes[path] = …`) to change what a
// URL serves; `requests` lists every request as "<host> <path>".
export async function startFixtureServer (routes) {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const hosts = { ip: `http://127.0.0.1:${port}`, name: `http://localhost:${port}` }
  const requests = []
  server.on('request', (request, response) => {
    const { pathname } = new URL(request.url, hosts.ip)
    requests.push(`${request.headers.host} ${pathname}`)
    const route = routes[pathname]
    if (!route) {
      response.writeHead(404).end()
      return
    }
    const { status = 200, headers = {}, body = '' } = route(hosts)
    response.writeHead(status, headers).end(body)
  })
  return { hosts, routes, requests, close: () => new Promise(resolve => server.close(resolve)) }
}
