export const DEFAULT_FEED_DISPLAY = Object.freeze({
  showImage: true,
  showDescription: true,
  descriptionMaxChars: 240 // 0 keeps the full normalized plain-text description
})

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
