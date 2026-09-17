import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError, api, token } from '../lib/api'
import { useMotionPrefs } from '../lib/motion'
import Globe, { type GlobePoint } from '../components/Globe'
import Logo from '../components/Logo'
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

const GLOBE = 430
/** Where the globe rests once the page has opened (matches .login__globe). */
const REST = { top: -70, right: -150 }
const INTRO_MS = 1600

/**
 * Sign in.
 *
 * It opens on a small, vivid globe turning alone in the middle of the page.
 * After a beat the globe swells and glides to the top-right, the wordmark
 * grows into place beneath the mark, and the form rises from the bottom.
 * The globe is one element the whole way, so the WebGL scene never resets.
 */
export default function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { reduced, spring } = useMotionPrefs()
  const [phase, setPhase] = useState<'intro' | 'page'>(reduced ? 'page' : 'intro')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('traveller@example.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (phase !== 'intro') return
    const id = window.setTimeout(() => setPhase('page'), INTRO_MS)
    return () => window.clearTimeout(id)
  }, [phase])

  // The globe's resting centre versus the screen centre, in its own frame.
  const introOffset = useMemo(() => {
    const width = window.innerWidth
    const height = window.innerHeight
    const restCentreX = width - REST.right - GLOBE / 2
    const restCentreY = REST.top + GLOBE / 2
    return { x: width / 2 - restCentreX, y: height * 0.4 - restCentreY }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const call = mode === 'login' ? api.login : api.register
      const { data } = await call(email.trim().toLowerCase(), password)
      token.set(data.access_token)
      onAuthenticated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach TripStash.')
    } finally {
      setBusy(false)
    }
  }

  const rise = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { ...spring, delay: reduced ? 0 : delay },
  })

  const landed = phase === 'page'

  return (
    <div className="login">
      <motion.div
        className="login__globe"
        initial={reduced ? false : { x: introOffset.x, y: introOffset.y, scale: 0, opacity: 0 }}
        animate={
          landed
            ? { x: 0, y: 0, scale: 1, opacity: 1 }
            : { x: introOffset.x, y: introOffset.y, scale: 0.36, opacity: 1 }
        }
        transition={
          landed
            ? { type: 'spring', stiffness: 90, damping: 20, mass: 1.1 }
            : { type: 'spring', stiffness: 160, damping: 18 }
        }
        style={{ transformOrigin: '50% 50%' }}
      >
        <Globe points={POINTS} route={ROUTE} focus={[-8, -52]} size={GLOBE} spin={landed ? 0.0025 : 0.012} vivid />
      </motion.div>

      {/* The opening beat: the name, small, under the globe. */}
      <AnimatePresence>
        {!landed && (
          <motion.div
            key="intro"
            className="login__intro"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.25 } }}
            transition={{ ...spring, delay: 0.35 }}
          >
            <span className="t-title">TripStash</span>
            <span className="t-small dimmer">Your places, from anywhere</span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="login__veil"
        aria-hidden
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: landed ? 1 : 0 }}
        transition={{ duration: 0.6 }}
      />

      {landed && (
        <div className="login__body">
          <div style={{ marginBottom: 'auto' }}>
            <Logo size={76} animate />
            <motion.h1 className="t-display--lg login__wordmark" {...rise(0.15)}>
              Trip
              <br />
              Stash
            </motion.h1>
            <motion.p className="t dim login__tagline" {...rise(0.24)}>
              Save places from Reels, screenshots and messages. See them around you. Get them back
              when the moment is right.
            </motion.p>
          </div>

          <motion.form className="card card--raised stack-4 login__form" onSubmit={submit} {...rise(0.34)}>
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                value={password}
                required
                minLength={mode === 'register' ? 10 : undefined}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                onChange={(event) => setPassword(event.target.value)}
              />
              {mode === 'register' && <span className="t-small dimmer">At least 10 characters.</span>}
            </label>

            {error && <Note tone="danger">{error}</Note>}

            <motion.button className="btn btn--ink btn--block" disabled={busy} type="submit" whileTap={{ scale: 0.98 }}>
              {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </motion.button>

            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
            >
              {mode === 'login' ? 'Create an account' : 'I already have an account'}
            </button>
          </motion.form>

          <motion.p className="t-small dimmer" style={{ marginTop: 'var(--s-5)' }} {...rise(0.44)}>
            Demo data: run <code>python -m app.seed</code> in <code>api/</code>, then sign in with the
            password it prints.
          </motion.p>
        </div>
      )}
    </div>
  )
}
