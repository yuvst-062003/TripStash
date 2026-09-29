/**
 * Where you are in the trip, and how to add to it.
 *
 * A progress bar showing how far along the route this destination sits, the
 * destination itself, and a plus on either side to put a new one before or
 * after it. Pressing the bar moves between destinations; the camera follows.
 *
 * The layout is right-to-left because the traveller writing this trip writes
 * in Hebrew, and a stepper that runs the wrong way is a stepper that reads
 * backwards. `dir="rtl"` on the row does that with no mirrored duplicates:
 * "before" and "after" stay the same words and swap sides by themselves.
 */
import { ChevronRight, Plus } from './icons'

export interface Destination {
  key: string
  name: string
  lat: number | null
  lon: number | null
}

interface Props {
  destinations: Destination[]
  /** Which one is shown, as an index. */
  index: number
  onGo: (index: number) => void
  onInsert: (beforeIndex: number) => void
  onOpen: (destination: Destination) => void
  /** How the trip is labelled, so "Stop 3" reads in the right language. */
  label?: (n: number) => string
  dir?: 'rtl' | 'ltr'
}

export default function DestinationStepper({
  destinations,
  index,
  onGo,
  onInsert,
  onOpen,
  label = (n) => `Stop ${n}`,
  dir = 'rtl',
}: Props) {
  if (destinations.length === 0) return null

  const clamped = Math.min(Math.max(index, 0), destinations.length - 1)
  const here = destinations[clamped]
  // The first destination should still show something, so progress counts the
  // gaps rather than the stops: one of four is a quarter, not nothing.
  const progress = ((clamped + 1) / destinations.length) * 100

  return (
    <div className="routebar" dir={dir} data-testid="routebar">
      <div className="routebar__track">
        <label className="routebar__bar">
          <span className="sr-only">
            {label(clamped + 1)} of {destinations.length}: {here.name}
          </span>
          <input
            type="range"
            min={0}
            max={destinations.length - 1}
            step={1}
            value={clamped}
            onChange={(e) => onGo(Number(e.target.value))}
            data-testid="stepper-range"
          />
          <span className="routebar__fill" style={{ width: `${progress}%` }} aria-hidden="true" />
        </label>
        <span className="routebar__badge t-field">{label(clamped + 1)}</span>
      </div>

      <div className="routebar__row">
        <button
          type="button"
          className="routebar__add"
          onClick={() => onInsert(clamped)}
          aria-label={`Add a destination before ${here.name}`}
          data-testid="stepper-add-before"
        >
          <Plus size={20} />
        </button>

        <span className="routebar__dashes" aria-hidden="true" />

        <button
          type="button"
          className="routebar__card"
          onClick={() => onOpen(here)}
          data-testid="stepper-card"
        >
          <span className="routebar__badge routebar__badge--card t-field">
            {label(clamped + 1)}
          </span>
          <span className="routebar__name">{here.name}</span>
          <span className="routebar__go" aria-hidden="true">
            <ChevronRight size={18} />
          </span>
        </button>

        <span className="routebar__dashes" aria-hidden="true" />

        <button
          type="button"
          className="routebar__add"
          onClick={() => onInsert(clamped + 1)}
          aria-label={`Add a destination after ${here.name}`}
          data-testid="stepper-add-after"
        >
          <Plus size={20} />
        </button>
      </div>
    </div>
  )
}
