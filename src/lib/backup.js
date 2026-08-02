import { feedSourceDisplay } from './feed-settings.js'

export function buildExportDocument (hosts, groups, sources) {
  return {
    version: 3,
    sites: (hosts || []).map(host => host.url),
    feedGroups: (groups || []).map(group => ({
      name: group.name,
      feeds: (sources || []).filter(source => source.groupId === group.id).map(source => ({
        type: source.type,
        url: source.url,
        title: source.title,
        discoveredFrom: source.discoveredFrom,
        display: feedSourceDisplay(source)
      }))
    }))
  }
}

export function parseImportDocument (parsed) {
  const list = Array.isArray(parsed) ? parsed : (parsed?.sites || parsed?.hosts || [])
  const sites = (Array.isArray(list) ? list : [])
    .map(host => (typeof host === 'string' ? host : host?.url))
    .filter(Boolean)
  const feedGroups = Array.isArray(parsed?.feedGroups)
    ? parsed.feedGroups.map(group => ({
        name: String(group?.name || '').trim(),
        feeds: (Array.isArray(group?.feeds) ? group.feeds : [])
          .filter(feed => feed?.type === 'rss' && feed?.url)
          .map(feed => ({
            type: 'rss', url: feed.url, title: String(feed.title || '').trim(),
            discoveredFrom: feed.discoveredFrom || null,
            display: feedSourceDisplay(feed)
          }))
      })).filter(group => group.name)
    : []
  return { sites, feedGroups }
}
