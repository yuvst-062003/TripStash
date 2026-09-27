/**
 * How much is behind a place, drawn rather than written.
 *
 * A clip you saved is an INKED impression. A clip the app found for you is a
 * DRY one - the same die, no ink - because a found clip counts for nothing
 * until you stamp it. One solid mark and three hollow ones tell you the ratio
 * before you have read a number, which is the whole point: "1 yours, 3 found"
 * is a sentence you have to parse, and this is not.
 *
 * The two kinds differ in fill AND edge, never in colour alone, so the
 * distinction survives for anyone who cannot separate gold from ink.
 */

/** Four marks is the ceiling. Past that you stop counting and see a bar. */
const CAP = 4

export type Mark = 'inked' | 'dry'

export interface Marks {
  marks: Mark[]
  /** Clips there was no room to draw. Shown as a figure instead. */
  rest: number
}

export function marksFor(yours: number, found: number): Marks {
  // Yours spends the cap first: it is the stronger claim, and a place with
  // three of your own and forty found should not read as mostly hollow.
  const inked = Math.min(yours, CAP)
  const dry = Math.min(found, Math.max(0, CAP - inked))
  return {
    marks: [
      ...Array<Mark>(inked).fill('inked'),
      ...Array<Mark>(dry).fill('dry'),
    ],
    rest: yours - inked + (found - dry),
  }
}

/** What the marks say, for anyone who cannot see them. */
function label(yours: number, found: number): string {
  if (found && !yours) return `${found} found, none of them yours yet`
  if (found) return `${yours} yours, ${found} found and not yet stamped`
  return yours === 1 ? '1 clip, yours' : `${yours} clips, yours`
}

interface Props {
  yours: number
  found: number
  /** Smaller marks for a dense row; the default suits a heading. */
  size?: 'sm' | 'md'
}

export default function Evidence({ yours, found, size = 'md' }: Props) {
  if (yours <= 0 && found <= 0) return null
  const { marks, rest } = marksFor(yours, found)

  return (
    <span
      role="img"
      aria-label={label(yours, found)}
      className={`evidence evidence--${size}`}
      data-testid="evidence"
    >
      {marks.map((kind, i) => (
        <span
          key={i}
          className={`mark mark--${kind}`}
          // A rotation per mark, so a row of them reads as impressions pressed
          // by hand rather than as a progress bar.
          style={{ transform: `rotate(${-8 + i * 5}deg)` }}
          aria-hidden="true"
        />
      ))}
      {rest > 0 && <span className="evidence__rest">+{rest}</span>}
    </span>
  )
}
