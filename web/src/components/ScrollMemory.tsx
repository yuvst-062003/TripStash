/**
 * Back returns to where you were.
 *
 * The router swaps screens without touching the scroll, and a screen that
 * fetches its content renders short first, so the browser's own restoration
 * has nothing to scroll to. This remembers the position per history entry
 * and, on a back or forward press, waits for the page to be tall enough
 * before scrolling there. A fresh screen starts at the top.
 */
import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

const positions = new Map<string, number>()

export default function ScrollMemory() {
  const location = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    const key = location.key
    const remember = () => positions.set(key, window.scrollY)
    window.addEventListener('scroll', remember, { passive: true })

    let frame = 0
    const wanted = navigationType === 'POP' ? (positions.get(key) ?? 0) : 0
    const started = performance.now()
    const settle = () => {
      const tall = document.documentElement.scrollHeight - window.innerHeight >= wanted
      if (tall || performance.now() - started > 1500) {
        window.scrollTo(0, wanted)
        return
      }
      frame = requestAnimationFrame(settle)
    }
    frame = requestAnimationFrame(settle)

    return () => {
      remember()
      window.removeEventListener('scroll', remember)
      cancelAnimationFrame(frame)
    }
  }, [location.key, navigationType])

  return null
}
