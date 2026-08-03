export const DEFAULT_FEED_DISPLAY = Object.freeze({
  showImage: true,
  showDescription: true,
  descriptionMaxChars: 240 // 0 keeps the full normalized plain-text description
})

export const DEFAULT_FEED_REFRESH = Object.freeze({ mode: 'auto', intervalMinutes: null })
export const FIXED_FEED_INTERVALS = Object.freeze([15, 30, 60, 180, 360, 720, 1440])

// Group-name identity must not vary with the browser's UI locale. This key is shared by storage
// validation and import matching so they always apply exactly the same comparison semantics.
export function feedGroupNameKey (name) {
  return String(name || '').toLowerCase()
}

export function feedSourceDisplay (source) {
  const display = source?.display || {}
  const rawLimit = display.descriptionMaxChars
  const descriptionMaxChars = rawLimit == null || rawLimit === ''
    ? DEFAULT_FEED_DISPLAY.descriptionMaxChars
    : Math.min(10000, Math.max(0, Math.floor(Number(rawLimit) || 0)))
  return {
    showImage: display.showImage !== false,
    showDescription: display.showDescription !== false,
    descriptionMaxChars
  }
}

export function feedSourceRefresh (source) {
  const refresh = source?.refresh || {}
  const mode = ['auto', 'fixed', 'off'].includes(refresh.mode) ? refresh.mode : DEFAULT_FEED_REFRESH.mode
  const raw = Number(refresh.intervalMinutes)
  const intervalMinutes = mode === 'fixed' && FIXED_FEED_INTERVALS.includes(raw) ? raw : null
  return { mode: mode === 'fixed' && intervalMinutes == null ? 'auto' : mode, intervalMinutes }
}

// Adopt cross-tab renames while preserving a local, unsaved edit. previousNames records the last
// storage value each draft was based on, so matching drafts are safe to replace with the new name.
export function syncFeedGroupDrafts (groups, drafts = {}, previousNames = {}) {
  const next = {}
  for (const group of groups || []) {
    const draft = drafts[group.id]
    next[group.id] = draft == null || draft === previousNames[group.id] ? group.name : draft
  }
  return next
}
