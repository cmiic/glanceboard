import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// browser.js binds `globalThis.browser` at module-evaluation time, so the mock has to exist before
// the import below. Mutate, never replace, the objects the binding captured.
const requestCalls = []
const grantedOrigins = []
let requestResult = true
let getAllThrows = false
// When set to an array, getAll() hands its resolver over instead of answering, so a test can decide
// when — and in which order — the in-flight refreshes come back.
let deferredGetAll = null
globalThis.browser = {
  permissions: {
    async request ({ origins }) {
      requestCalls.push([...origins])
      if (requestResult) grantedOrigins.push(...origins)
      return requestResult
    },
    async getAll () {
      if (getAllThrows) throw new Error('nope')
      if (deferredGetAll) return new Promise(resolve => deferredGetAll.push(origins => resolve({ origins })))
      return { origins: [...grantedOrigins] }
    }
  }
}

const {
  createGrantedOriginsCache, loadGrantedOrigins, missingOrigins, requestMissingOrigins
} = await import('../src/lib/permissions.js')

beforeEach(() => {
  requestCalls.length = 0
  grantedOrigins.length = 0
  requestResult = true
  getAllThrows = false
  deferredGetAll = null
})

test('missingOrigins: drops granted patterns, dedupes, and ignores empty entries', () => {
  const missing = missingOrigins(
    ['https://a.example/*', 'https://b.example/*', 'https://b.example/*', null, ''],
    ['https://a.example/*']
  )
  assert.deepEqual(missing, ['https://b.example/*'])
})

test('missingOrigins: tolerates missing arguments', () => {
  assert.deepEqual(missingOrigins(undefined, undefined), [])
  assert.deepEqual(missingOrigins(['https://a.example/*'], undefined), ['https://a.example/*'])
})

test('requestMissingOrigins: asks only for the patterns that are not granted yet', async () => {
  grantedOrigins.push('https://a.example/*')
  const result = await requestMissingOrigins(['https://a.example/*', 'https://b.example/*'], grantedOrigins)
  assert.deepEqual(requestCalls, [['https://b.example/*']])
  assert.deepEqual(result, { granted: true, origins: ['https://b.example/*'] })
})

// The reported bug: a second feed on an already-granted host still triggered a request, and Firefox
// rejects that once the gesture is gone — even though it would have been a no-op.
test('requestMissingOrigins: skips the request entirely when everything is granted', async () => {
  const result = await requestMissingOrigins(['https://a.example/*'], ['https://a.example/*'])
  assert.deepEqual(requestCalls, [])
  assert.deepEqual(result, { granted: true, origins: [] })
})

test('requestMissingOrigins: reports a refused prompt without claiming the origins', async () => {
  requestResult = false
  const result = await requestMissingOrigins(['https://a.example/*'], [])
  assert.equal(result.granted, false)
  assert.deepEqual(result.origins, ['https://a.example/*'])
})

// Firefox checks `isHandlingUserInput`, which is false again after the first await. The helper must
// therefore reach browser.permissions.request() synchronously — before the caller's `await` on it
// yields — so that a click handler awaiting it first keeps the gesture.
test('requestMissingOrigins: issues the request before yielding to the event loop', () => {
  const pending = requestMissingOrigins(['https://a.example/*'], [])
  assert.deepEqual(requestCalls, [['https://a.example/*']], 'request must not wait for a microtask')
  return pending
})

test('loadGrantedOrigins: returns the granted patterns and swallows failures', async () => {
  grantedOrigins.push('https://a.example/*')
  assert.deepEqual(await loadGrantedOrigins(), ['https://a.example/*'])
  getAllThrows = true
  assert.deepEqual(await loadGrantedOrigins(), [])
})

test('granted cache: refresh seeds from the browser, add and remove apply immediately', async () => {
  const cache = createGrantedOriginsCache()
  grantedOrigins.push('https://a.example/*')
  await cache.refresh()
  assert.deepEqual(cache.list(), ['https://a.example/*'])

  cache.add(['https://b.example/*'])
  cache.remove(['https://a.example/*'])
  assert.deepEqual(cache.list(), ['https://b.example/*'])

  cache.add(undefined)
  cache.remove(undefined)
  assert.deepEqual(cache.list(), ['https://b.example/*'])
})

// A revoke, or a permissions.onRemoved payload, is newer than a getAll() that was already on its
// way. Letting the snapshot win would put the removed origin back and make the next click skip the
// request it needs.
test('granted cache: a change during a refresh survives the refresh', async () => {
  deferredGetAll = []
  const cache = createGrantedOriginsCache()
  const pending = cache.refresh()
  cache.remove(['https://a.example/*'])
  deferredGetAll[0](['https://a.example/*'])
  await pending
  assert.deepEqual(cache.list(), [])
})

test('granted cache: an older refresh cannot overwrite a newer one', async () => {
  deferredGetAll = []
  const cache = createGrantedOriginsCache()
  const first = cache.refresh()
  const second = cache.refresh()
  deferredGetAll[1](['https://new.example/*'])
  await second
  deferredGetAll[0](['https://stale.example/*'])
  await first
  assert.deepEqual(cache.list(), ['https://new.example/*'])
})

// The regression this guards is an ordering one inside a Vue click handler, and the project has no
// component-rendering test setup. Checking the source keeps the invariant enforced: in a handler
// that requests permissions, the permission call has to be the first `await` in the function.
test('AddHostForm: permission requests stay the first await in their click handler', async () => {
  const source = await readFile(new URL('../src/ui/components/AddHostForm.vue', import.meta.url), 'utf8')
  const handlers = [...source.matchAll(/async function (\w+) \(/g)]
    .map(match => ({ name: match[1], body: stripComments(functionBody(source, match.index)) }))
    .filter(handler => handler.body.includes('requestMissingOrigins('))

  assert.ok(handlers.length >= 3, 'expected the add, redirect, and confirm handlers to request permissions')
  for (const handler of handlers) {
    const firstAwait = handler.body.slice(handler.body.indexOf('await ')).split('\n')[0]
    assert.match(firstAwait, /requestMissingOrigins\(/,
      `${handler.name}: first await is "${firstAwait.trim()}" — it must be the permission request`)
  }
})

// Comments explain this very invariant, so they must not be mistaken for code. `//` only counts at
// a line start or after whitespace, which leaves the `//` in URLs (preceded by `:`) alone.
function stripComments (body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')
}

// Body of the function whose `async function` keyword starts at `start`, by brace matching.
function functionBody (source, start) {
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error('unbalanced function body')
}
