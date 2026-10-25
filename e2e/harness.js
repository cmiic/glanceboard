// Browser tests drive a real Firefox with the built extension installed. They need Firefox 137 or
// newer (WebDriver BiDi `webExtension.install`) and a build in .output/firefox-mv2, which
// `npm run test:e2e` makes first. See TESTING.md, "Browser tests (Firefox, local)".
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

export async function launchFirefox () {
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
      'extensions.webextensions.uuids': JSON.stringify({ [EXTENSION_ID]: EXTENSION_UUID })
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
// would never settle: start the navigation without a timeout, then wait for the page itself.
export async function openExtensionPage (browser, path) {
  const page = await browser.newPage()
  const url = `${EXTENSION_BASE}/${path}`
  page.goto(url, { timeout: 0 }).catch(() => {})
  await page.waitForFunction(
    expected => location.href === expected && document.readyState === 'complete',
    { timeout: 10000 },
    url
  )
  return page
}

// Click an element the way real mouse input arrives. WebDriver refuses to send input into
// extension pages: Firefox counts them as privileged, and both BiDi's input.performActions and
// Marionette reject privileged contexts. So the mouse events are synthesized in the browser window
// (the parent process, reachable with system access) at the element's position, and Firefox
// routes them into the page as trusted input — a user gesture, which permissions.request() needs.
export async function click (page, selector) {
  const target = await page.$eval(selector, element => {
    element.scrollIntoView({ block: 'center' })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, url: location.href }
  })
  const connection = page.browser().connection
  const { result: { contexts } } = await connection.send('browsingContext.getTree', { 'moz:scope': 'chrome' })
  const { result } = await connection.send('script.callFunction', {
    target: { context: contexts[0].context },
    functionDeclaration: String(function (x, y, url) {
      const tabBrowser = window.gBrowser
      const browserElement = tabBrowser.browsers.find(item => item.currentURI.spec === url)
      if (!browserElement) throw new Error(`No tab shows ${url}`)
      tabBrowser.selectedTab = tabBrowser.getTabForBrowser(browserElement)
      const rect = browserElement.getBoundingClientRect()
      for (const type of ['mousedown', 'mouseup']) {
        window.synthesizeMouseEvent(type, rect.left + x, rect.top + y, { button: 0, clickCount: 1 })
      }
    }),
    arguments: [
      { type: 'number', value: target.x },
      { type: 'number', value: target.y },
      { type: 'string', value: target.url }
    ],
    awaitPromise: false
  })
  if (result.type === 'exception') throw new Error(`click(${selector}): ${result.exceptionDetails.text}`)
}

// Set a text field the way v-model listens for it. Typing needs no user gesture, and keyboard input
// into extension pages is refused for the same reason as clicks.
export async function fill (page, selector, value) {
  await page.$eval(selector, (element, text) => {
    element.value = text
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

// A loopback HTTP server for fixture pages and feeds. `routes` maps a path to a function of the
// server's base URLs, so a page on one host can point at the other: http://127.0.0.1:<port> and
// http://localhost:<port> are different hosts to the extension's per-host permissions.
export async function startFixtureServer (routes) {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const hosts = { ip: `http://127.0.0.1:${port}`, name: `http://localhost:${port}` }
  server.on('request', (request, response) => {
    const route = routes[new URL(request.url, hosts.ip).pathname]
    if (!route) {
      response.writeHead(404).end()
      return
    }
    const { status = 200, headers = {}, body = '' } = route(hosts)
    response.writeHead(status, headers).end(body)
  })
  return { hosts, close: () => new Promise(resolve => server.close(resolve)) }
}
