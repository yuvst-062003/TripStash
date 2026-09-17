import { useSyncExternalStore } from 'react'

/**
 * Preferences that live on the device: colour scheme and language.
 *
 * Both are applied to <html> so CSS and the platform pick them up: the theme
 * through `data-theme`, the language through `lang` and `dir`. Nothing here
 * touches the server — a preference is not trip data.
 */
export type Theme = 'auto' | 'light' | 'dark'
export type Lang = 'en' | 'he' | 'es'

export const LANGS: { value: Lang; label: string; native: string; locale: string; dir: 'ltr' | 'rtl' }[] = [
  { value: 'en', label: 'English', native: 'English', locale: 'en-GB', dir: 'ltr' },
  { value: 'he', label: 'Hebrew', native: 'עברית', locale: 'he-IL', dir: 'rtl' },
  { value: 'es', label: 'Spanish', native: 'Español', locale: 'es-ES', dir: 'ltr' },
]

const THEME_KEY = 'tripstash.theme'
const LANG_KEY = 'tripstash.lang'

interface Prefs {
  theme: Theme
  lang: Lang
}

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

let prefs: Prefs = {
  theme: read(THEME_KEY, ['auto', 'light', 'dark'] as const, 'auto'),
  lang: read(LANG_KEY, ['en', 'he', 'es'] as const, 'en'),
}
const listeners = new Set<() => void>()

export function applyPrefs(next: Prefs = prefs) {
  const root = document.documentElement
  // While the tokens flip, no control eases its own colour: one cut, not a smear.
  root.dataset.themeSwitching = ''
  if (next.theme === 'auto') delete root.dataset.theme
  else root.dataset.theme = next.theme
  const lang = LANGS.find((entry) => entry.value === next.lang) ?? LANGS[0]
  root.lang = lang.value
  root.dir = lang.dir
  void getComputedStyle(root).opacity
  requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching))
  // The browser chrome follows the chosen scheme, not only the OS one.
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
  if (next.theme === 'auto') {
    meta?.remove()
  } else {
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.prepend(meta)
    }
    meta.content = next.theme === 'dark' ? '#0a1c1f' : '#f3faf6'
  }
}

/** The locale for dates and numbers, outside React (formatters live in plain functions). */
export const currentLocale = () => LANGS.find((entry) => entry.value === prefs.lang)?.locale ?? 'en-GB'

function write(next: Partial<Prefs>) {
  prefs = { ...prefs, ...next }
  try {
    localStorage.setItem(THEME_KEY, prefs.theme)
    localStorage.setItem(LANG_KEY, prefs.lang)
  } catch {
    // Private mode or blocked storage: the choice still applies for this visit.
  }
  applyPrefs()
  listeners.forEach((listener) => listener())
}

export const setTheme = (theme: Theme) => write({ theme })
export const setLang = (lang: Lang) => write({ lang })

export function usePrefs(): Prefs & { locale: string } {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => prefs,
  )
  const locale = LANGS.find((entry) => entry.value === current.lang)?.locale ?? 'en-GB'
  return { ...current, locale }
}
