import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError, api, token } from '../lib/api'
import { useMotionPrefs } from '../lib/motion'
import type { GlobePoint } from '../components/Globe'
import Logo from '../components/Logo'
import Planet from '../components/Planet'
import Starfield from '../components/Starfield'
import { Note } from '../components/ui'

/**
 * Illustrative pins for the sign-in globe. The app is for any trip, so the
 * globe keeps turning and the pins are spread across every continent; the
 * one drawn route is a short overland hop, the kind of thing people stash.
 */
const ROUTE: [number, number][] = [
  [-13.53, -71.97], // Cusco
  [-16.39, -71.54], // Arequipa
  [-16.5, -68.15], // La Paz
  [-20.13, -67.49], // Salar de Uyuni
]
const POINTS: GlobePoint[] = [
  ...ROUTE.map(([lat, lon], index) => ({ lat, lon, size: index === 0 ? 0.09 : 0.06, hot: true })),
  { lat: 14.56, lon: -90.73 }, // Antigua
  { lat: 38.72, lon: -9.14 }, // Lisbon
  { lat: 21.03, lon: 105.85 }, // Hanoi
  { lat: -33.93, lon: 18.42 }, // Cape Town
  { lat: 35.01, lon: 135.77 }, // Kyoto
  { lat: 64.15, lon: -21.94 }, // Reykjavík
  { lat: -8.65, lon: 115.22 }, // Bali
  { lat: 41.0, lon: 28.98 }, // Istanbul
  { lat: -41.29, lon: 174.78 }, // Wellington
  { lat: 19.43, lon: -99.13 }, // Mexico City
]

/** One number drives both the CSS box and the intro maths, so they cannot drift. */
const GLOBE = 360
const REST_TOP = 176
const INTRO_MS = 1100
const INTRO_SEEN = 'tripstash.intro-seen'
const LAST_EMAIL = 'tripstash.email'
const SKY = '#030913'

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode: the intro simply plays again next time */
  }
}

/**
 * Sign in — the Earth from orbit.
 *
 * The first time, a small globe turns alone in the middle of the page for a
 * beat, then swells into place beneath the wordmark as the glass form rises
 * over the planet's lower half. A tap skips it; a returning traveller never
 * sees it. The globe is one element the whole way, so the scene never resets.
 */
export default function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { reduced } = useMotionPrefs()
  const [phase, setPhase] = useState<'intro' | 'page'>(() =>
    reduced || read(INTRO_SEEN) ? 'page' : 'intro',
  )
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState(
    () => read(LAST_EMAIL) ?? (import.meta.env.DEV ? 'traveller@example.com' : ''),
  )
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (phase !== 'intro') return
    const id = window.setTimeout(() => setPhase('page'), INTRO_MS)
    return () => window.clearTimeout(id)
  }, [phase])
  useEffect(() => {
    if (phase === 'page') write(INTRO_SEEN, '1')
  }, [phase])

  // The browser chrome above a night sky should be night too, whatever the
  // OS scheme; the media-qualified metas in index.html are for the app proper.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = SKY
    document.head.prepend(meta)
    return () => meta.remove()
  }, [])

  // The globe's resting centre versus the screen centre, in its own frame.
  const introOffset = useMemo(
    () => ({ x: 0, y: window.innerHeight * 0.42 - (REST_TOP + GLOBE / 2) }),
    [],
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const call = mode === 'login' ? api.login : api.register
      const { data } = await call(email.trim().toLowerCase(), password)
      token.set(data.access_token)
      write(LAST_EMAIL, email.trim().toLowerCase())
      // Let the form slip away before the app appears behind it.
      setLeaving(true)
      window.setTimeout(onAuthenticated, reduced ? 0 : 200)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 401
            ? 'Wrong email or password.'
            : err.message
          : 'Could not reach TripStash.',
      )
      setBusy(false)
    }
  }

  const landed = phase === 'page'
  const landing = { type: 'spring', stiffness: 140, damping: 24, mass: 1 } as const
  const rise = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { ...landing, delay: reduced ? 0 : delay },
  })
  const globeProps = {
    points: POINTS,
    route: ROUTE,
    focus: [-8, -52] as [number, number],
    size: GLOBE,
    spin: landed ? 0.0022 : 0.011,
  }
  const label = busy
    ? mode === 'login'
      ? 'Signing in…'
      : 'Creating account…'
    : mode === 'login'
      ? 'Sign in'
      : 'Create account'

  return (
    <motion.div
      className="login login--space"
      onPointerDown={() => !landed && setPhase('page')}
      animate={leaving ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeIn' }}
    >
      <Starfield />
      <motion.div
        className="login__globe"
        style={{ top: REST_TOP, marginLeft: -GLOBE / 2 }}
        initial={reduced ? false : { x: introOffset.x, y: introOffset.y, scale: 0.3, opacity: 0 }}
        animate={
          landed
            ? { x: 0, y: 0, scale: 1, opacity: 1 }
            : { x: introOffset.x, y: introOffset.y, scale: 0.4, opacity: 1 }
        }
        transition={landed ? landing : { type: 'spring', stiffness: 220, damping: 28 }}
      >
        <Planet {...globeProps} />
      </motion.div>

      {/* The opening beat: the name, small, under the globe. */}
      <AnimatePresence>
        {!landed && (
          <motion.div
            key="intro"
            className="login__intro"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18, ease: 'easeIn' } }}
            transition={{ ...landing, delay: 0.25 }}
          >
            <span className="t-title">TripStash</span>
            <span className="t-small" style={{ color: 'var(--ink-2)' }}>
              Save places from anywhere
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="login__veil"
        aria-hidden
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: landed ? 1 : 0 }}
        transition={landing}
      />

      {landed && (
        <div className="login__body">
          <motion.div className="login__head" {...rise(0.05)}>
            <Logo size={44} animate delay={0.35} />
            <h1 className="t-display login__wordmark">TripStash</h1>
          </motion.div>
          <motion.p className="t login__tagline" {...rise(0.1)}>
            Save places from Reels, screenshots and messages. See them around you. Get them back
            when the moment is right.
          </motion.p>

          <motion.form
            className="login__form stack-4"
            onSubmit={submit}
            aria-busy={busy}
            {...rise(0.15)}
            animate={leaving ? { opacity: 0, y: 12 } : { opacity: 1, y: 0 }}
          >
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                name="email"
                id="email"
                dir="ltr"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                autoComplete="email"
                required
                onChange={(event) => {
                  setEmail(event.target.value)
                  setError(null)
                }}
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                name="password"
                id="password"
                enterKeyHint="go"
                value={password}
                required
                minLength={mode === 'register' ? 10 : undefined}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError(null)
                }}
              />
              <span className="login__hint">
                <AnimatePresence initial={false}>
                  {mode === 'register' && (
                    <motion.span
                      key="hint"
                      className="t-small"
                      style={{ color: 'var(--ink-3)' }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      At least 10 characters.
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </label>

            {/* Bad news is never delayed: the slot is always there, the note appears at once. */}
            <div className="login__error" role="alert" aria-live="assertive">
              {error && <Note tone="danger">{error}</Note>}
            </div>

            <motion.button
              className="btn btn--ink btn--block"
              type="submit"
              aria-disabled={busy}
              aria-busy={busy}
              whileTap={busy ? undefined : { scale: 0.98 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={label}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  {label}
                </motion.span>
              </AnimatePresence>
            </motion.button>

            <button
              type="button"
              className="btn btn--ghost btn--block login__switch"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
            >
              {mode === 'login' ? 'New here? Create an account' : 'I already have an account'}
            </button>
          </motion.form>

          {import.meta.env.DEV && (
            <motion.p className="t-small" style={{ marginTop: 'var(--s-5)', color: 'var(--ink-3)' }} {...rise(0.2)}>
              Demo account: <code>traveller@example.com</code> / <code>tripstash-demo-password</code>
            </motion.p>
          )}
        </div>
      )}
    </motion.div>
  )
}
