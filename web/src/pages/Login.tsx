import { useState } from 'react'
import { motion } from 'motion/react'
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

export default function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('traveller@example.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { reduced, spring } = useMotionPrefs()

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

  return (
    <div className="login">
      {/* The globe sits behind everything, top-right, and can be spun by hand. */}
      <motion.div
        className="login__globe"
        initial={reduced ? false : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <Globe points={POINTS} route={ROUTE} focus={[-8, -52]} size={430} spin={0.0025} />
      </motion.div>

      <div className="login__veil" aria-hidden />

      <div className="login__body">
        <div style={{ marginBottom: 'auto' }}>
          <Logo size={76} animate />
          <motion.h1 className="t-display--lg login__wordmark" {...rise(0.3)}>
            Trip
            <br />
            Stash
          </motion.h1>
          <motion.p className="t dim login__tagline" {...rise(0.38)}>
            Save places from Reels, screenshots and messages. See them around you. Get them back
            when the moment is right.
          </motion.p>
        </div>

        <motion.form className="card card--raised stack-4 login__form" onSubmit={submit} {...rise(0.46)}>
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

        <motion.p className="t-small dimmer" style={{ marginTop: 'var(--s-5)' }} {...rise(0.55)}>
          Demo data: run <code>python -m app.seed</code> in <code>api/</code>, then sign in with the
          password it prints.
        </motion.p>
      </div>
    </div>
  )
}
