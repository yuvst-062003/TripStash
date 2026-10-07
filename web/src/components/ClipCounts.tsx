/**
 * Yours and found, told apart.
 *
 * A clip you saved is yours. A clip the app went looking for is found: a
 * suggestion that counts for nothing until you keep it. The two differ in
 * border style - solid against dashed - and in the word, never in colour
 * alone, so the difference holds for anyone who cannot separate the tints.
 */
import { Film } from './icons'

export default function ClipCounts({ yours, found }: { yours: number; found: number }) {
  if (yours <= 0 && found <= 0) return null
  return (
    <span className="clipcounts num">
      {yours > 0 && (
        <span className="cliptag cliptag--yours" aria-label={`${yours} saved by you`}>
          <Film size={12} /> {yours} yours
        </span>
      )}
      {found > 0 && (
        <span className="cliptag cliptag--found" aria-label={`${found} found, not yours yet`}>
          {found} found
        </span>
      )}
    </span>
  )
}
