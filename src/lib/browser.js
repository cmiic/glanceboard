// Firefox exposes the Promise-based WebExtension API as the global `browser`.
// Single import point so the rest of the code never touches the global directly
// (and so it's trivial to shim in tests later).
export const browser = globalThis.browser
export default browser
