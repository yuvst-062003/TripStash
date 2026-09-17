import { useState } from 'react'
import { motion } from 'motion/react'
import { ApiError, api, token } from '../lib/api'
import { useMotionPrefs } from '../lib/motion'
import Contours from '../components/Contours'
import { Stamp } from '../components/Stamp'
import { Note } from '../components/ui'
import { MapPin } from '../components/icons'

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

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden' }}>
      <Contours />

      <div
        className="pad"
        style={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100dvh',
          maxWidth: 480,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          paddingTop: 'calc(var(--s-12) + env(safe-area-inset-top))',
          paddingBottom: 'calc(var(--s-6) + env(safe-area-inset-bottom))',
        }}
      >
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          style={{ marginBottom: 'auto' }}
        >
          <div style={{ marginBottom: 'var(--s-4)' }}>
            <Stamp tone="coral" size="lg" Icon={MapPin} rotate={-7}>
              Travel memory
            </Stamp>
          </div>
          <h1 className="t-display--lg" style={{ fontSize: 'clamp(3.25rem, 17vw, 4.75rem)' }}>
            Trip
            <br />
            Stash
          </h1>
          <p className="t dim" style={{ marginTop: 'var(--s-4)', maxWidth: '30ch' }}>
            Save places from Reels, screenshots and messages. See them around you. Get them back
            when the moment is right.
          </p>
        </motion.div>

        <motion.form
          className="card card--raised stack-4"
          onSubmit={submit}
          initial={reduced ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: reduced ? 0 : 0.08 }}
          style={{ marginTop: 'var(--s-8)', padding: 'var(--s-5)' }}
        >
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

          <motion.button
            className="btn btn--ink btn--block"
            disabled={busy}
            type="submit"
            whileTap={{ scale: 0.98 }}
          >
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

        <p className="t-small dimmer" style={{ marginTop: 'var(--s-5)' }}>
          Demo data: run <code>python -m app.seed</code> in <code>api/</code>, then sign in with the
          password it prints.
        </p>
      </div>
    </div>
  )
}
