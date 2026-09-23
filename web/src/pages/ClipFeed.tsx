/**
 * The clip feed: saved videos for one spot, one after another.
 *
 * Two things separate this from the feed it borrows its gesture from. Every
 * clip here is one the traveller saved themselves - nothing is recommended in
 * - and each one opens at the second the place was actually named, because the
 * extraction pipeline recorded that moment as evidence. The whole video stays
 * one tap away, so the cut is an offer rather than a decision.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useScreenContext } from '../lib/context'
import { useAsync } from '../lib/hooks'
import type { ReelClip } from '../lib/types'
import { Empty, ErrorNote, SkeletonRows, pairText } from '../components/ui'
import {
  ArrowLeft,
  ArrowUpRight,
  CATEGORY_ICON,
  Film,
  MapPin,
  Play,
  Scissors,
  Volume2,
  VolumeX,
} from '../components/icons'

/**
 * What to call the clip's source in one line.
 *
 * An upload's stored title is its filename and a link's is often the URL
 * itself - neither tells the traveller anything the screen does not already
 * show, so they give way to the host it came from.
 */
function sourceLabel(clip: ReelClip): string | null {
  const title = clip.title?.trim()
  const looksLikeTheFileOrLink =
    !title ||
    title === clip.url ||
    /^https?:\/\//i.test(title) ||
    /\.(mp4|mov|webm|m4v|avi)$/i.test(title)
  if (!looksLikeTheFileOrLink) return title
  if (!clip.url) return null
  try {
    return new URL(clip.url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export default function ClipFeed() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const spot = params.get('spot')
  const scope = params.get('scope')
  const destination = params.get('destination')

  // Sound is off until the traveller asks for it: a feed that starts talking
  // on a bus is the reason people stop opening apps.
  const [muted, setMuted] = useState(true)
  // Per clip, because wanting the whole of one video says nothing about the next.
  const [whole, setWhole] = useState<Record<string, boolean>>({})
  const [activeId, setActiveId] = useState<string | null>(null)

  const feed = useAsync(
    () => api.reels({ trip_place_id: spot, scope, destination_id: destination }),
    [spot, scope, destination],
  )
  const clips = useMemo(() => feed.data ?? [], [feed.data])

  useScreenContext(
    spot ? { surface: 'place', tripPlaceId: spot, label: clips[0]?.place_name } : { surface: 'saved' },
  )

  useEffect(() => {
    if (!activeId && clips.length) setActiveId(clips[0].id)
  }, [clips, activeId])

  const title = scope ?? clips[0]?.place_name ?? 'Clips'
  const position = activeId ? clips.findIndex((clip) => clip.id === activeId) + 1 : 0

  if (feed.loading && !feed.data) {
    return (
      <div className="screen">
        <SkeletonRows rows={3} />
      </div>
    )
  }
  if (feed.error) {
    return (
      <div className="screen">
        <ErrorNote message={feed.error} onRetry={feed.reload} />
      </div>
    )
  }

  if (!clips.length) {
    return (
      <div className="screen">
        <div className="pad" style={{ paddingTop: 'var(--s-4)' }}>
          <button className="btn btn--sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Back
          </button>
        </div>
        <Empty
          title="No saved video here yet"
          body="Clips appear once you save a video and approve a place from it."
        />
      </div>
    )
  }

  return (
    <div className="feed">
      <header className="feed__bar">
        <button className="feed__chip" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="feed__heading">
          <p className="t clamp-1">{title}</p>
          <p className="feed__count num">
            {position || 1} of {clips.length}
          </p>
        </div>
        <button
          className="feed__chip"
          onClick={() => setMuted((value) => !value)}
          aria-pressed={!muted}
          aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </header>

      <div className="feed__track">
        {clips.map((clip) => (
          <Slide
            key={clip.id}
            clip={clip}
            active={clip.id === activeId}
            muted={muted}
            whole={Boolean(whole[clip.id])}
            onToggleWhole={() =>
              setWhole((current) => ({ ...current, [clip.id]: !current[clip.id] }))
            }
            onVisible={() => setActiveId(clip.id)}
          />
        ))}
      </div>
    </div>
  )
}

interface SlideProps {
  clip: ReelClip
  active: boolean
  muted: boolean
  whole: boolean
  onToggleWhole: () => void
  onVisible: () => void
}

function Slide({ clip, active, muted, whole, onToggleWhole, onVisible }: SlideProps) {
  const slide = useRef<HTMLElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [blocked, setBlocked] = useState(false)
  // A browser that cannot decode this file should say so once, rather than
  // leaving a play button that never does anything.
  const [undecodable, setUndecodable] = useState(false)
  const [elapsed, setElapsed] = useState(clip.start_seconds)

  const start = whole ? 0 : clip.start_seconds
  const end = whole ? clip.duration_seconds : clip.end_seconds
  const Icon = CATEGORY_ICON[clip.place_category] ?? MapPin

  useEffect(() => {
    const element = slide.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && onVisible(),
      { threshold: 0.6 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [onVisible])

  const seekToStart = useCallback(() => {
    const element = video.current
    if (!element) return
    // Seeking needs the duration, which only arrives with the metadata. This
    // runs on every switch between the section and the whole video, so it has
    // to move the playhead back to zero too, not only forward.
    if (Number.isFinite(element.duration)) element.currentTime = start
    setElapsed(start)
  }, [start])

  useEffect(() => {
    const element = video.current
    if (!element) return
    if (!active) {
      element.pause()
      return
    }
    seekToStart()
    // Autoplay can be refused even when muted; say so rather than showing a
    // still frame that looks broken.
    element.play().then(
      () => setBlocked(false),
      () => setBlocked(true),
    )
  }, [active, seekToStart])

  function onTimeUpdate() {
    const element = video.current
    if (!element) return
    setElapsed(element.currentTime)
    if (end != null && element.currentTime >= end) element.currentTime = start
  }

  const meta = [clip.scope_label, clip.author, sourceLabel(clip)].filter(Boolean)
  // The takeaway is often the place name itself; showing both twice reads as
  // a bug rather than as emphasis.
  const { detail: caption } = pairText(clip.place_name, clip.takeaway || clip.quote)

  return (
    <section className="slide" ref={slide} aria-label={`${clip.place_name} clip`}>
      {clip.file_url && !undecodable ? (
        <>
          <video
            ref={video}
            className="slide__video"
            src={`${clip.file_url}#t=${clip.start_seconds}`}
            muted={muted}
            playsInline
            loop
            preload="metadata"
            onLoadedMetadata={seekToStart}
            onError={() => setUndecodable(true)}
            onTimeUpdate={onTimeUpdate}
            onClick={() => {
              const element = video.current
              if (!element) return
              if (element.paused) element.play().then(() => setBlocked(false), () => undefined)
              else element.pause()
            }}
          />
          {blocked && (
            <button className="slide__resume" onClick={() => video.current?.play()}>
              <Play size={20} /> Tap to play
            </button>
          )}
        </>
      ) : (
        <div className="slide__missing">
          <Film size={28} />
          <p className="t">{undecodable ? 'This browser cannot play it' : 'Saved as a link'}</p>
          <p className="t-small">
            {undecodable
              ? `The file is here${clip.media_type ? ` as ${clip.media_type}` : ''}, but this browser has no decoder for it. It will play in the app on your phone.`
              : 'TripStash kept what it could read from this one, not the video itself.'}
          </p>
        </div>
      )}

      <div className="slide__shade" />

      <div className="slide__body">
        <Link className="slide__place" to={`/places/${clip.trip_place_id}`}>
          <Icon size={16} />
          <span className="t-head clamp-1">{clip.place_name}</span>
        </Link>
        {meta.length > 0 && <p className="slide__meta clamp-1">{meta.join(' · ')}</p>}
        {caption && <p className="slide__quote clamp-3">{caption}</p>}

        <div className="slide__actions">
          {clip.file_url && !clip.is_whole_video && (
            <button
              className="feed__chip feed__chip--wide"
              onClick={onToggleWhole}
              aria-pressed={whole}
            >
              <Scissors size={15} />
              {whole ? 'Saved section' : 'Whole video'}
            </button>
          )}
          {clip.url && (
            <a
              className="feed__chip feed__chip--wide"
              href={clip.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ArrowUpRight size={15} /> Original
            </a>
          )}
        </div>
      </div>

      {clip.file_url && clip.duration_seconds ? (
        <div className="slide__scrub" aria-hidden>
          {/* The saved section, shown in place on the full running time. */}
          <span
            className="slide__section"
            style={{
              left: `${(clip.start_seconds / clip.duration_seconds) * 100}%`,
              width: `${(((clip.end_seconds ?? clip.duration_seconds) - clip.start_seconds) / clip.duration_seconds) * 100}%`,
            }}
          />
          <span
            className="slide__head"
            style={{ left: `${Math.min(100, (elapsed / clip.duration_seconds) * 100)}%` }}
          />
        </div>
      ) : null}

      {clip.file_url && clip.moment_seconds != null && !whole && (
        <p className="slide__stamp num">saved at {clock(clip.moment_seconds)}</p>
      )}
    </section>
  )
}
