import { useState } from 'react'
import { ApiError, api, token } from '../lib/api'
import { Note } from '../components/ui'

export default function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('traveller@example.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    <div
      className="pad"
      style={{
        minHeight: '100dvh',
        maxWidth: 420,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        paddingBottom: 'var(--s-10)',
      }}
    >
      <h1 className="t-xl">TripStash</h1>
      <p className="t dim" style={{ marginTop: 6 }}>
        Save places from anywhere, see them around you, and bring them back when the moment is right.
      </p>

      <form className="stack-4" onSubmit={submit} style={{ marginTop: 'var(--s-8)' }}>
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
          {mode === 'register' && <span className="t-sm dimmer">At least 10 characters.</span>}
        </label>

        {error && <Note tone="danger">{error}</Note>}

        <button className="btn btn--accent btn--block" disabled={busy} type="submit">
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          className="btn btn--plain btn--block"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
        >
          {mode === 'login' ? 'Create an account' : 'I already have an account'}
        </button>
      </form>

      <p className="t-sm dimmer" style={{ marginTop: 'var(--s-8)' }}>
        Demo data: run <code>python -m app.seed</code> in <code>api/</code>, then sign in with the
        password it prints.
      </p>
    </div>
  )
}
