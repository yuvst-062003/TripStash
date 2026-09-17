import { motion } from 'motion/react'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { useAsync } from '../lib/hooks'
import { LANGS, setLang, setTheme, usePrefs, type Theme } from '../lib/prefs'
import Drawer from './Drawer'
import ExportButton from './ExportButton'
import Segmented from './Segmented'
import { Stamp } from './Stamp'
import { SectionLabel } from './ui'
import { Globe, LogOut, Moon, Sun, SunMoon } from './icons'

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'auto', label: 'Auto', Icon: SunMoon },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

/** The initial of the account, in a coral-to-teal disc. */
export function Avatar({ email, size = 40 }: { email?: string | null; size?: number }) {
  const letter = (email ?? '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {letter}
    </span>
  )
}

/**
 * The account drawer: who you are, how the app looks, which language it
 * speaks, and the two account actions. Preferences apply as you tap them.
 */
export default function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { trip, signOut } = useApp()
  const prefs = usePrefs()
  const me = useAsync(() => api.me(), [])
  const email = me.data?.email ?? 'traveller'

  return (
    <Drawer title="You" onClose={onClose}>
      <div className="pad" style={{ paddingTop: 'var(--s-2)' }}>
        <div className="row" style={{ gap: 'var(--s-4)' }}>
          <Avatar email={email} size={56} />
          <div className="grow" style={{ minWidth: 0 }}>
            <p className="t-head clamp-1">{email}</p>
            <p className="t-small dim clamp-1">{trip ? `On ${trip.name}` : 'No trip yet'}</p>
          </div>
        </div>
      </div>

      <SectionLabel>Appearance</SectionLabel>
      <Segmented
        label="Colour scheme"
        value={prefs.theme}
        onChange={setTheme}
        options={THEMES.map((theme) => ({ value: theme.value, label: theme.label }))}
      />
      <p className="pad t-small dimmer" style={{ marginTop: 'var(--s-3)' }}>
        Auto follows your phone. Sign-in and the journey card stay dark either way — a planet
        needs a night sky.
      </p>

      <SectionLabel>Language</SectionLabel>
      <Segmented
        label="Language"
        value={prefs.lang}
        onChange={setLang}
        options={LANGS.map((lang) => ({ value: lang.value, label: lang.native }))}
      />
      <div className="pad" style={{ marginTop: 'var(--s-3)' }}>
        <div className="row" style={{ gap: 'var(--s-2)', alignItems: 'flex-start' }}>
          <Globe size={15} strokeWidth={2.2} className="dimmer" style={{ marginTop: 2, flex: 'none' }} />
          <p className="t-small dimmer">
            Layout direction, numbers and dates follow this now. Translated interface text is on
            the way — for the moment the words stay in English.
          </p>
        </div>
      </div>

      <SectionLabel>Account</SectionLabel>
      <div className="pad stack">
        <ExportButton />
        <motion.button className="btn btn--ghost btn--block" whileTap={{ scale: 0.98 }} onClick={signOut}>
          <LogOut size={16} strokeWidth={2.2} />
          Sign out
        </motion.button>
      </div>

      <div className="pad" style={{ marginTop: 'var(--s-6)', display: 'flex', justifyContent: 'center' }}>
        <Stamp tone="muted" size="sm" rotate={-4}>
          TripStash · yours only
        </Stamp>
      </div>
    </Drawer>
  )
}
