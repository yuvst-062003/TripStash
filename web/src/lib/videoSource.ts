/**
 * Which host a saved link belongs to, and how to play it HERE.
 *
 * "Here" is the whole point. A clip that opens YouTube has taken the traveller
 * out of the trip they were planning, and getting back is two app switches. So
 * every host that permits an embed gets one, and the ones that do not get an
 * honest panel rather than a way out of the app.
 *
 * Nothing in this file downloads or re-hosts a video. That would give us full
 * control and would also be theft: it breaks every one of these platforms'
 * terms and removes the creator from their own work. Embedding is the route
 * they actually sanction, and it keeps the credit on the clip.
 */

export type VideoSource =
  | { host: 'youtube'; id: string }
  | { host: 'tiktok'; id: string }
  | { host: 'instagram'; id: string }
  | { host: 'other' }

export interface Embed {
  kind: 'iframe'
  src: string
  /**
   * Whether the player can be sent to a given second.
   *
   * Only YouTube can. TikTok and Instagram embeds expose no seek at all, so
   * their panels print the quote with its timestamp and let the traveller
   * scrub by hand - ten seconds into a forty-second clip is a small ask, and
   * pretending otherwise would be the lie.
   */
  seekable: boolean
  host: VideoSource['host']
}

export function readSource(url: string | null | undefined): VideoSource | null {
  if (!url) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { host: 'other' }
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  const parts = parsed.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be' && parts[0]) return { host: 'youtube', id: parts[0] }

  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const watching = parsed.searchParams.get('v')
    if (watching) return { host: 'youtube', id: watching }
    if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) {
      return { host: 'youtube', id: parts[1] }
    }
  }

  if (host.endsWith('tiktok.com')) {
    const at = parts.indexOf('video')
    if (at >= 0 && parts[at + 1]) return { host: 'tiktok', id: parts[at + 1] }
  }

  if (
    host.endsWith('instagram.com') &&
    (parts[0] === 'reel' || parts[0] === 'reels' || parts[0] === 'p') &&
    parts[1]
  ) {
    return { host: 'instagram', id: parts[1] }
  }

  return { host: 'other' }
}

export function youtubeEmbed(id: string, startSeconds: number): string {
  const params = new URLSearchParams({
    mute: '1',
    autoplay: '1',
    start: String(Math.max(0, Math.round(startSeconds || 0))),
    rel: '0',
    playsinline: '1',
    modestbranding: '1',
  })
  // The no-cookie host, so watching a clip in a planning app is not logged as
  // watching it on YouTube.
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`
}

export function embedFor(url: string | null | undefined, startSeconds: number): Embed | null {
  const source = readSource(url)
  if (!source) return null

  switch (source.host) {
    case 'youtube':
      return { kind: 'iframe', src: youtubeEmbed(source.id, startSeconds), seekable: true, host: 'youtube' }

    case 'tiktok':
      return {
        kind: 'iframe',
        src: `https://www.tiktok.com/embed/v2/${encodeURIComponent(source.id)}`,
        seekable: false,
        host: 'tiktok',
      }

    case 'instagram':
      return {
        kind: 'iframe',
        src: `https://www.instagram.com/reel/${encodeURIComponent(source.id)}/embed`,
        seekable: false,
        host: 'instagram',
      }

    default:
      // Somewhere we cannot embed. The panel shows the quote and says the clip
      // is not playable here, rather than offering a door out of the app.
      return null
  }
}

/** What to call a host in a caption. */
export function hostLabel(host: VideoSource['host']): string {
  return host === 'youtube'
    ? 'youtube'
    : host === 'tiktok'
      ? 'tiktok'
      : host === 'instagram'
        ? 'instagram'
        : 'a link'
}
