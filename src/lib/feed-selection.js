import { normalizeTarget } from './url.js'

// The add dialog's review step: which discovered feeds the user picked, into which group, and what
// the confirmation click hands to storage. Kept free of Vue and of the browser API so the rules are
// testable on their own; the component owns the reactive state and the permission prompt.

// The group <select>'s value for "create a new group".
export const NEW_GROUP = '__new__'

// Why the selection cannot be confirmed, or '' when it can. Synchronous on purpose: it runs before
// the permission request, which must stay the confirmation click's first awaited operation.
export function selectionError ({ wantsFeeds, selected, groupChoice, groupName }) {
  if (!wantsFeeds) return ''
  if (!selected.length) return 'Select at least one feed'
  if (groupChoice === NEW_GROUP && !String(groupName || '').trim()) return 'Enter a feed group name'
  return ''
}

export function selectedOriginPatterns (selected) {
  return [...new Set(selected.map(item => normalizeTarget(item.url)?.originPattern).filter(Boolean))]
}

// A feed whose validation redirected it: the review now offers, and keeps selected, the URL it
// redirected to, so the next click requests that exact origin.
export function retargetCandidate ({ candidates, selectedUrls }, fromUrl, result) {
  return {
    candidates: candidates.map(candidate =>
      candidate.url === fromUrl ? { ...candidate, url: result.url, validated: result.cache } : candidate),
    selectedUrls: selectedUrls.map(url => url === fromUrl ? result.url : url)
  }
}

export function feedSourceInput (item, result, discoveredFrom) {
  return {
    type: item.type,
    url: result.url,
    title: result.cache.channel?.title || item.title,
    discoveredFrom,
    cache: result.cache
  }
}

// The argument for addSiteAndFeedSources(): the page as a site when the user chose it, and the feeds
// into either the chosen existing group or a new one.
export function siteAndFeedsRequest ({ review, choice, wantsFeeds, groupChoice, groupName, feeds }) {
  const wantsSite = !review.direct && (choice === 'site' || choice === 'both')
  const newGroup = groupChoice === NEW_GROUP
  return {
    siteInput: wantsSite ? review.pageUrl : null,
    feeds,
    groupId: wantsFeeds && !newGroup ? groupChoice : null,
    groupName: wantsFeeds && newGroup ? groupName : ''
  }
}
