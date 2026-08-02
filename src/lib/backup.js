import { feedSourceDisplay, feedSourceRefresh } from './feed-settings.js'
import { normalizeHttpUrl } from './rss.js'
import { normalizeTarget } from './url.js'

export function normalizeImportFeed (feed) {
  const raw = String(feed?.url || '').trim()
  if (!raw || (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw))) return null
  const url = normalizeHttpUrl(normalizeTarget(raw)?.url)
  return url ? { ...feed, url } : null
}

export function buildExportDocument (hosts, groups, sources, readLater = []) {
  return {
    version: 4,
    sites: (hosts || []).map(host => host.url),
    feedGroups: (groups || []).map(group => ({
      name: group.name,
      feeds: (sources || []).filter(source => source.groupId === group.id).map(source => ({
        type: source.type,
        url: source.url,
        title: source.title,
        discoveredFrom: source.discoveredFrom,
        display: feedSourceDisplay(source),
        refresh: feedSourceRefresh(source)
      }))
    })),
    readLater: (readLater || []).map(item => ({ ...item }))
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
          .filter(feed => ['rss', 'atom', 'jsonfeed'].includes(feed?.type) && feed?.url)
          .map(feed => ({
            type: feed.type, url: feed.url, title: String(feed.title || '').trim(),
            discoveredFrom: feed.discoveredFrom || null,
            display: feedSourceDisplay(feed), refresh: feedSourceRefresh(feed)
          }))
      })).filter(group => group.name)
    : []
  const readLater = Array.isArray(parsed?.readLater) ? parsed.readLater.filter(item => item && typeof item === 'object') : []
  return { sites, feedGroups, readLater }
}
