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
import TripHome from './pages/TripHome'
import Explore from './pages/Explore'
import Country from './pages/Country'
import City from './pages/City'
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
  Compass,
  Film,
  Globe,
  type IconComponent,
  Luggage,
  Plus,
} from './components/icons'

// Four top-level areas, and Save is not one of them: a tab bar navigates
// between areas of an app, and an action belongs somewhere else. Four also
// keeps the pill clear of the overflow "More" item that makes the trailing
// tab harder to reach.
const TABS: { to: string; label: string; Icon: IconComponent }[] = [
  { to: '/', label: 'Trip', Icon: Luggage },
  { to: '/clips', label: 'Clips', Icon: Film },
  { to: '/saved', label: 'Saved', Icon: Bookmark },
  { to: '/explore', label: 'Explore', Icon: Compass },
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
          {/* Home is the trip. Opening the app lands on the route. */}
          <Route path="/" element={<TripHome />} />
          {/* Explore is the trip's own map zoomed out until stops become
              countries, which is why discovery reads as a continuation of
              planning rather than a separate place. */}
          <Route path="/explore" element={<Explore />} />
          <Route path="/explore/:country" element={<Country />} />
          <Route path="/cities/:city" element={<City />} />
          {/* The pin-level map of saved places, reached from Saved. */}
          <Route path="/map" element={<MapScreen />} />
          <Route path="/today" element={<Home />} />
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

        {/* The control layer: navigation in the pill, the one global action
            beside it. Ask lives in each screen, where the context it would
            inherit is visible. */}
        {!immersive && (
          <div className="navdock">
            <nav className="tabbar" aria-label="Main">
              {TABS.map(({ to, label, Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} className="tabbar__item">
                  {({ isActive }) => (
                    <>
                      <Icon size={21} strokeWidth={isActive ? 2.4 : 1.8} />
                      {label}
                      {/* Weight and a dot, not colour alone. */}
                      {isActive && <span className="tabbar__dot" aria-hidden="true" />}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <button
              className="savecircle"
              onClick={() => setSaveOpen('link')}
              aria-label="Save a link"
            >
              <Plus size={24} strokeWidth={2.4} />
            </button>
          </div>
        )}

        {askSeed && <AskSheet seed={askSeed} onClose={() => setAskSeed(null)} />}
        {saveOpen && (
          <SaveSheet initialMode={saveOpen} onClose={() => setSaveOpen(false)} />
        )}
      </div>
    </AppContext.Provider>
  )
}
