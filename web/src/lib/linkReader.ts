/**
 * Reading a link from the browser, not the server.
 *
 * The server is the worst place to read a social link. It sits on a datacenter
 * IP, which is exactly what bot protection blocks first, and it is signed in to
 * nothing. The traveller's own browser is on a residential connection, already
 * holds whatever session the platform gave it, and is where the content was
 * being looked at anyway.
 *
 * So the client reads and the server understands. This calls only the public,
 * documented oEmbed endpoints a platform publishes for embedding - the same
 * request any blog makes to show a preview. It does not log in, scrape markup
 * or download media.
 */

export interface BrowserLinkRead {
  title?: string
  author?: string
  text?: string
  provider?: string
  /** Which path produced this, shown to the traveller and recorded as a stage. */
  reader: 'browser-oembed'
}

const OEMBED: { match: RegExp; endpoint: (url: string) => string }[] = [
  {
    match: /(^|\.)tiktok\.com$/,
    endpoint: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  },
  {
    match: /(^|\.)(youtube\.com|youtu\.be)$/,
    endpoint: (url) =>
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  },
  {
    match: /(^|\.)vimeo\.com$/,
    endpoint: (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  },
]

const TIMEOUT_MS = 8000

export function hasBrowserReader(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return OEMBED.some((entry) => entry.match.test(host))
  } catch {
    return false
  }
}

/**
 * Returns what the platform publishes, or null.
 *
 * Null is an ordinary outcome, not an error: the post may be private, the
 * platform may refuse cross-origin reads, or the traveller may be offline. Every
 * one of those falls through to the server attempt and then to asking.
 */
export async function readLinkInBrowser(url: string): Promise<BrowserLinkRead | null> {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }

  const entry = OEMBED.find((candidate) => candidate.match.test(host))
  if (!entry) return null

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(entry.endpoint(url), {
      signal: controller.signal,
      // No credentials: this asks for what is public, nothing more.
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null

    const data = (await response.json()) as Record<string, unknown>
    // On TikTok and YouTube the caption arrives as `title`.
    const title = typeof data.title === 'string' ? data.title.trim() : undefined
    if (!title) return null

    return {
      title,
      author: typeof data.author_name === 'string' ? data.author_name : undefined,
      text: title,
      provider: typeof data.provider_name === 'string' ? data.provider_name : host,
      reader: 'browser-oembed',
    }
  } catch {
    // CORS, network, abort - all the same to the caller.
    return null
  } finally {
    window.clearTimeout(timer)
  }
}
