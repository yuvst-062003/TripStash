import { useRef } from 'react'
import { useApp } from '../lib/context'
import { LANGS, setLang, setTheme, usePrefs, type Lang, type Theme } from '../lib/prefs'
import Drawer, { DrawerClose } from './Drawer'
import ExportButton from './ExportButton'
import Segmented from './Segmented'
import { LogOut } from './icons'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** The one sentence a reader of each language must be able to read. */
const LANGUAGE_NOTE: Record<Lang, string> = {
  en: 'Layout direction, dates and numbers follow this now. Translated interface text is on the way — for the moment the words stay in English.',
  he: 'כיוון הפריסה, התאריכים והמספרים כבר עוקבים אחרי הבחירה. תרגום הממשק בדרך — בינתיים המילים נשארות באנגלית.',
  es: 'La dirección, las fechas y los números ya siguen esta elección. La traducción de la interfaz está en camino; por ahora los textos siguen en inglés.',
}

/** The initial of the account, in an inked disc. */
export function Avatar({ email, size = 40 }: { email?: string | null; size?: number }) {
  const letter = (email ?? '').trim().charAt(0).toUpperCase() || '?'
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {letter}
    </span>
  )
}

/**
 * The account drawer: who you are, how the app looks, which language it
 * speaks, and the two account actions. Preferences apply as you tap them;
 * signing out waits for the sheet to leave.
 */
export default function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { trip, me, signOut } = useApp()
  const prefs = usePrefs()
  const leaving = useRef(false)

  return (
    <Drawer
      title="You"
      description="Your account, appearance, language, export and sign out"
      onClose={() => {
        onClose()
        if (leaving.current) signOut()
      }}
    >
      <div className="pad" style={{ paddingTop: 'var(--s-2)' }}>
        <div className="row" style={{ gap: 'var(--s-4)' }}>
          <Avatar email={me?.email} size={56} />
          <div className="grow" style={{ minWidth: 0 }}>
            {me ? (
              <p className="t-title clamp-1" dir="ltr" style={{ fontSize: '1.125rem' }}>
                {me.email}
              </p>
            ) : (
              <div className="skeleton" style={{ height: 20, width: '60%' }} />
            )}
            <p className="t-small dim clamp-1" style={{ marginTop: 2 }}>
              {trip ? `On ${trip.name}` : 'No trip yet'}
            </p>
          </div>
        </div>
      </div>

      <p className="pad drawer__group">Appearance</p>
      <Segmented
        kind="radio"
        even
        label="Colour scheme"
        value={prefs.theme}
        onChange={setTheme}
        options={THEMES}
      />
      <p className="pad t-small dimmer" style={{ marginTop: 'var(--s-3)' }}>
        Auto follows your phone. Sign-in and the journey card stay dark either way — a planet
        needs a night sky.
      </p>

      <p className="pad drawer__group">Language</p>
      <Segmented
        kind="radio"
        even
        label="Language"
        value={prefs.lang}
        onChange={setLang}
        options={LANGS.map((lang) => ({ value: lang.value, label: lang.native, lang: lang.value }))}
      />
      <p className="pad t-small dimmer" style={{ marginTop: 'var(--s-3)' }} lang={prefs.lang}>
        {LANGUAGE_NOTE[prefs.lang]}
      </p>

      <p className="pad drawer__group">Account</p>
      <div className="pad stack">
        <ExportButton />
        <DrawerClose asChild>
          <button
            className="btn btn--ghost btn--block"
            onClick={() => {
              leaving.current = true
            }}
          >
            <LogOut size={16} strokeWidth={2.2} />
            Sign out
          </button>
        </DrawerClose>
      </div>

      <p className="pad t-small dimmer" style={{ marginTop: 'var(--s-6)', textAlign: 'center' }}>
        Your stash is yours only. Nothing here is shared or sold.
      </p>
    </Drawer>
  )
}
