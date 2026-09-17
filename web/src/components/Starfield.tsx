import { useMemo } from 'react'

/** A quiet field of stars, seeded so it is the same sky every time. */
export default function Starfield({ count = 110 }: { count?: number }) {
  const stars = useMemo(() => {
    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    return Array.from({ length: count }, () => ({
      x: random() * 100,
      y: random() * 100,
      r: 0.4 + random() * 1.1,
      o: 0.35 + random() * 0.65,
    }))
  }, [count])

  return (
    <svg className="starfield" aria-hidden>
      {stars.map((star, index) => (
        <circle key={index} cx={`${star.x}%`} cy={`${star.y}%`} r={star.r} fill="#ffffff" opacity={star.o} />
      ))}
    </svg>
  )
}
