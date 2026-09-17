import { createContext, useContext, useEffect } from 'react'
import type { LocationState, Position } from './hooks'
import type { Trip } from './types'

export interface AskSeed {
  question?: string
  surface: string
  tripPlaceId?: string
  placeId?: string
  sourceId?: string
  destinationId?: string
  contextLabel?: string
}

/** What the screen currently on top is about, so Ask inherits it automatically. */
export interface ScreenContext {
  surface: string
  tripPlaceId?: string
  placeId?: string
  sourceId?: string
  destinationId?: string
  label?: string
}

export interface Me {
  id: string
  email: string
  display_name: string | null
}

export interface AppContextValue {
  /** The account, once known; null while it loads. */
  me: Me | null
  trip: Trip | null
  reloadTrip: () => void
  location: LocationState
  requestLocation: () => void
  setManualLocation: (position: Position) => void
  position: Position | null
  screenContext: ScreenContext | null
  setScreenContext: (context: ScreenContext | null) => void
  openAsk: (seed?: AskSeed) => void
  openSave: () => void
  openProfile: () => void
  signOut: () => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside the app shell')
  return value
}

/**
 * Registers this screen's context for the duration of its mount.
 *
 * Spec 5.5: the assistant is handed the current screen's context without the
 * traveller having to restate it, and can then be told to drop it.
 */
export function useScreenContext(context: ScreenContext | null) {
  const { setScreenContext } = useApp()
  const key = JSON.stringify(context)
  useEffect(() => {
    setScreenContext(context ? JSON.parse(key) : null)
    return () => setScreenContext(null)
  }, [key, setScreenContext])
}
