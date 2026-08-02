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
