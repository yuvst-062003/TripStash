import { useCallback, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation as useRoute } from 'react-router-dom'
import { api, token } from './lib/api'
import { AppContext, type AskSeed, type ScreenContext } from './lib/context'
import { useAsync, useLocation, useOnlineStatus } from './lib/hooks'
import AskSheet from './components/AskSheet'
import SaveSheet from './components/SaveSheet'
import Login from './pages/Login'
import NewTrip from './pages/NewTrip'
import Home from './pages/Home'
import MapScreen from './pages/MapScreen'
import Saved from './pages/Saved'
import Clips from './pages/Clips'
import ClipFeed from './pages/ClipFeed'
import TripScreen from './pages/TripScreen'
import Place from './pages/Place'
import ShareTarget from './pages/ShareTarget'
import { Note, SkeletonRows } from './components/ui'
import {
  Bookmark,
  Film,
  Globe,
  Home as HomeIcon,
  type IconComponent,
  Luggage,
  MapIcon,
  Plus,
} from './components/icons'

const TABS: { to: string; label: string; Icon: IconComponent }[] = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/map', label: 'Map', Icon: MapIcon },
  { to: '/saved', label: 'Saved', Icon: Bookmark },
  { to: '/clips', label: 'Clips', Icon: Film },
  { to: '/trip', label: 'Trip', Icon: Luggage },
]

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(token.get()))
  const [askSeed, setAskSeed] = useState<AskSeed | null>(null)
  const [saveOpen, setSaveOpen] = useState<false | 'link' | 'album'>(false)
  const [screenContext, setScreenContext] = useState<ScreenContext | null>(null)
  const online = useOnlineStatus()
  // The clip feed owns the whole screen; the tab bar and Save would only sit
  // on top of the picture.
  const immersive = useRoute().pathname === '/clips/feed'
  const { state: location, request: requestLocation, setManual: setManualLocation } = useLocation()

  const tripState = useAsync(() => api.currentTrip(), [authed], authed)

  const signOut = useCallback(() => {
    token.clear()
    setAuthed(false)
  }, [])

  const position = location.status === 'granted' ? location.position : null

  const value = useMemo(
    () => ({
      trip: tripState.data,
      reloadTrip: tripState.reload,
      location,
      requestLocation,
      setManualLocation,
      position,
      screenContext,
      setScreenContext,
      // With no seed of its own, Ask inherits whatever screen is on top.
      openAsk: (seed?: AskSeed) =>
        setAskSeed(
          seed ?? {
            surface: screenContext?.surface ?? 'home',
            tripPlaceId: screenContext?.tripPlaceId,
            placeId: screenContext?.placeId,
            sourceId: screenContext?.sourceId,
            destinationId: screenContext?.destinationId,
            contextLabel: screenContext?.label,
          },
        ),
      openSave: (mode?: 'link' | 'album') => setSaveOpen(mode ?? 'link'),
      signOut,
    }),
    [
      tripState.data,
      tripState.reload,
      location,
      requestLocation,
      setManualLocation,
      position,
      screenContext,
      signOut,
    ],
  )

  if (!authed) return <Login onAuthenticated={() => setAuthed(true)} />

  if (tripState.loading && !tripState.data) {
    return (
      <div className="screen">
        <div className="topbar" />
        <SkeletonRows rows={5} />
      </div>
    )
  }

  // A 404 here means the account has no active trip yet, not a broken app.
  if (!tripState.data) return <NewTrip onCreated={tripState.reload} onSignOut={signOut} />

  return (
    <AppContext.Provider value={value}>
      <div className="app">
        {!online && (
          <div className="pad" style={{ paddingBlock: 'var(--s-2)' }}>
            <Note tone="warn" Icon={Globe}>
              Offline. Showing what is cached — edits are queued until you reconnect.
            </Note>
          </div>
        )}

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/map" element={<MapScreen />} />
          <Route path="/saved" element={<Saved />} />
          <Route path="/clips" element={<Clips />} />
          {/* The feed takes the whole screen, tab bar and all. */}
          <Route path="/clips/feed" element={<ClipFeed />} />
          <Route path="/trip" element={<TripScreen />} />
          <Route path="/places/:tripPlaceId" element={<Place />} />
          {/* Declared in the manifest as the share target; the OS lands here. */}
          <Route path="/save" element={<ShareTarget />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Save is the one action worth floating; Ask lives in each screen's
            top bar, where the context it inherits is visible. */}
        {!immersive && (
          <button className="fab" onClick={() => setSaveOpen('link')}>
            <Plus size={18} strokeWidth={2.4} />
            Save
          </button>
        )}

        <nav className="tabbar" aria-label="Main" hidden={immersive}>
          {TABS.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className="tabbar__item">
              {({ isActive }) => (
                <>
                  <Icon size={21} strokeWidth={isActive ? 2.3 : 1.8} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {askSeed && <AskSheet seed={askSeed} onClose={() => setAskSeed(null)} />}
        {saveOpen && (
          <SaveSheet initialMode={saveOpen} onClose={() => setSaveOpen(false)} />
        )}
      </div>
    </AppContext.Provider>
  )
}
