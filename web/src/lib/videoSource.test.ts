import { describe, expect, it } from 'vitest'
import { embedFor, readSource, youtubeEmbed } from './videoSource'

describe('readSource', () => {
  it('reads a watch link', () => {
    expect(readSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      host: 'youtube',
      id: 'dQw4w9WgXcQ',
    })
  })

  it('reads a short link', () => {
    expect(readSource('https://youtu.be/dQw4w9WgXcQ')).toEqual({ host: 'youtube', id: 'dQw4w9WgXcQ' })
  })

  it('reads a shorts link, which is what a travel clip usually is', () => {
    expect(readSource('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({
      host: 'youtube',
      id: 'dQw4w9WgXcQ',
    })
  })

  it('reads a tiktok video link', () => {
    expect(readSource('https://www.tiktok.com/@someone/video/7234567890123456789')).toEqual({
      host: 'tiktok',
      id: '7234567890123456789',
    })
  })

  it('reads an instagram reel link', () => {
    expect(readSource('https://www.instagram.com/reel/CxYzAbC1234/')).toEqual({
      host: 'instagram',
      id: 'CxYzAbC1234',
    })
  })

  it('calls anything else other, rather than guessing', () => {
    expect(readSource('https://example.com/a.mp4')).toEqual({ host: 'other' })
    expect(readSource('not a url at all')).toEqual({ host: 'other' })
  })

  it('handles no url at all', () => {
    expect(readSource(null)).toBeNull()
    expect(readSource('')).toBeNull()
  })
})

describe('youtubeEmbed', () => {
  it('starts muted, at the second the quote came from', () => {
    const src = youtubeEmbed('abc123', 32)
    expect(src).toContain('/embed/abc123')
    expect(src).toContain('mute=1')
    expect(src).toContain('start=32')
  })

  it('starts at zero when there is no timestamp', () => {
    expect(youtubeEmbed('abc123', 0)).toContain('start=0')
  })

  it('rounds a fractional second rather than sending a decimal', () => {
    expect(youtubeEmbed('abc123', 32.7)).toContain('start=33')
  })

  it('refuses a negative start instead of passing it on', () => {
    expect(youtubeEmbed('abc123', -5)).toContain('start=0')
  })

  it('never asks for related videos from other channels', () => {
    expect(youtubeEmbed('abc123', 0)).toContain('rel=0')
  })

  it('uses the no-cookie host, so watching here is not tracked as watching there', () => {
    expect(youtubeEmbed('abc123', 0)).toContain('youtube-nocookie.com')
  })
})

describe('embedFor', () => {
  // The rule the whole feed turns on: nothing may hand the traveller to another
  // app. Where a host permits an embed we take it; where it does not, we say so
  // rather than offering a way out.
  it('gives YouTube a seekable frame', () => {
    const e = embedFor('https://youtu.be/abc', 32)
    expect(e?.kind).toBe('iframe')
    expect(e?.seekable).toBe(true)
  })

  it('gives TikTok a frame it cannot seek, and says so', () => {
    const e = embedFor('https://www.tiktok.com/@a/video/7234567890123456789', 8)
    expect(e?.kind).toBe('iframe')
    expect(e?.seekable).toBe(false)
    expect(e?.src).toContain('tiktok.com/embed')
  })

  it('gives Instagram a frame it cannot seek', () => {
    const e = embedFor('https://www.instagram.com/reel/CxYz1234/', 0)
    expect(e?.kind).toBe('iframe')
    expect(e?.seekable).toBe(false)
  })

  // A link we cannot embed gets no player and no escape hatch: the panel shows
  // the quote, which is what the traveller came for anyway.
  it('offers nothing to press for a host it cannot embed', () => {
    expect(embedFor('https://example.com/video', 0)).toBeNull()
  })
})
