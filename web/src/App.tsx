import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation as useRouterLocation,
  useNavigationType,
} from 'react-router-dom'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { api, token } from './lib/api'
import { AppContext, type AskSeed, type ScreenContext } from './lib/context'
import { useAsync, useLocation, useOnlineStatus } from './lib/hooks'
import { useMotionPrefs } from './lib/motion'
import { tick } from './lib/haptics'
import AskSheet from './components/AskSheet'
import SaveSheet from './components/SaveSheet'
import ProfileSheet from './components/ProfileSheet'
import Journey from './pages/Journey'
import Login from './pages/Login'
import NewTrip from './pages/NewTrip'
import Home from './pages/Home'
import MapScreen from './pages/MapScreen'
import Saved from './pages/Saved'
import TripScreen from './pages/TripScreen'
import Place from './pages/Place'
import { Note, SkeletonRows } from './components/ui'
import { Globe } from './components/icons'
import {
  BookmarkIcon,
  BriefcaseBusinessIcon,
  HomeIcon,
  MapPinIcon,
  PlusIcon,
  type PlusIconHandle,
} from './components/motion'

type AnimatedIcon = typeof HomeIcon

const TABS: { to: string; label: string; Icon: AnimatedIcon }[] = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/map', label: 'Map', Icon: MapPinIcon },
  { to: '/saved', label: 'Saved', Icon: BookmarkIcon },
  { to: '/trip', label: 'Trip', Icon: BriefcaseBusinessIcon },
]

/** The tab icon plays its animation once each time the tab becomes active. */
function TabIcon({ Icon, active }: { Icon: AnimatedIcon; active: boolean }) {
  const ref = useRef<{ startAnimation: () => void; stopAnimation: () => void }>(null)
  const { reduced } = useMotionPrefs()
  useEffect(() => {
    if (!active || reduced) return
    ref.current?.startAnimation()
    const id = window.setTimeout(() => ref.current?.stopAnimation(), 500)
    return () => window.clearTimeout(id)
  }, [active, reduced])
  return <Icon ref={ref} size={22} aria-hidden />
}

const TAB_ORDER = ['/', '/map', '/saved', '/trip']

/** Which way a route change travels: along the tab bar, or deeper for a detail page. */
function direction(from: string, to: string): 1 | -1 {
  const a = TAB_ORDER.indexOf(from)
  const b = TAB_ORDER.indexOf(to)
  if (a === -1) return -1 // coming back up from a detail page
  if (b === -1) return 1 // going down into one
  return b >= a ? 1 : -1
}

/** True until the first route has mounted: a cold load shows content, not a slide. */
let booted = false
export function useColdLoad(): boolean {
  const cold = useRef(!booted).current
  useEffect(() => {
    booted = true
  }, [])
  return cold
}

/**
 * Every route slides in along the direction of travel — translate for
 * navigation, never scale — entering in 200 ms and leaving in 120 ms. The
 * direction is handed in through `custom` so the page on its way out gets
 * the same answer as the one arriving.
 */
const EASE_OUT = [0.22, 1, 0.36, 1] as const
const EASE_IN = [0.4, 0, 1, 1] as const
const PAGE: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: 18 * dir }),
  center: { opacity: 1, x: 0, transition: { duration: 0.2, ease: EASE_OUT } },
  exit: (dir: number) => ({ opacity: 0, x: -14 * dir, transition: { duration: 0.12, ease: EASE_IN } }),
}

function Page({ children, dir }: { children: ReactNode; dir: number }) {
  const { reduced } = useMotionPrefs()
  const cold = useColdLoad()
  return (
    <motion.div
      className="page"
      variants={PAGE}
      // `custom` on AnimatePresence reaches only the exit; the entrance needs its own.
      custom={dir}
      initial={reduced || cold ? false : 'enter'}
      animate="center"
      exit={reduced ? undefined : 'exit'}
    >
      {children}
    </motion.div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(token.get()))
  const [askSeed, setAskSeed] = useState<AskSeed | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [screenContext, setScreenContext] = useState<ScreenContext | null>(null)
  const online = useOnlineStatus()
  const route = useRouterLocation()
  // Direction of travel, decided once per route change and shared with the exiting page.
  const prevPath = useRef(route.pathname)
  const dir = useRef<1 | -1>(1)
  // Scroll offsets by history entry: the browser's own restoration would move
  // the page while it is still on its way out, so it is done here instead.
  const navType = useNavigationType()
  const scrolls = useRef(new Map<string, number>())
  const prevKey = useRef(route.key)
  if (prevPath.current !== route.pathname) {
    dir.current = direction(prevPath.current, route.pathname)
    scrolls.current.set(prevKey.current, window.scrollY)
    prevPath.current = route.pathname
    prevKey.current = route.key
  }
  const { state: location, request: requestLocation, setManual: setManualLocation } = useLocation()
  const plusRef = useRef<PlusIconHandle>(null)

  const tripState = useAsync(() => api.currentTrip(), [authed], authed)

  const signOut = useCallback(() => {
    token.clear()
    setAuthed(false)
  }, [])

  const position = location.status === 'granted' ? location.position : null
  const immersive = route.pathname === '/trip/journey'

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
      openSave: () => setSaveOpen(true),
      openProfile: () => setProfileOpen(true),
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
        <div className="hero">
          <div className="skeleton" style={{ height: 44, width: '60%' }} />
        </div>
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

        <AnimatePresence
          mode="wait"
          custom={dir.current}
          onExitComplete={() => {
            const y = navType === 'POP' ? (scrolls.current.get(route.key) ?? 0) : 0
            window.scrollTo({ top: y, behavior: 'instant' })
            // Once more when the arriving page has laid out, so a restored offset is not clamped.
            requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' }))
          }}
        >
          <Routes location={route} key={route.pathname}>
            <Route path="/" element={<Page dir={dir.current}><Home /></Page>} />
            <Route path="/map" element={<Page dir={dir.current}><MapScreen /></Page>} />
            <Route path="/saved" element={<Page dir={dir.current}><Saved /></Page>} />
            <Route path="/trip" element={<Page dir={dir.current}><TripScreen /></Page>} />
            <Route path="/trip/journey" element={<Page dir={dir.current}><Journey /></Page>} />
            <Route path="/places/:tripPlaceId" element={<Page dir={dir.current}><Place /></Page>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>

        {/* Save is the one action worth floating; Ask lives in each screen's
            header, where the context it inherits is visible. */}
        {!immersive && (
        <motion.button
          className="fab"
          whileTap={{ scale: 0.97 }}
          onClick={() => setSaveOpen(true)}
          onPointerEnter={() => plusRef.current?.startAnimation()}
          onPointerLeave={() => plusRef.current?.stopAnimation()}
        >
          <PlusIcon ref={plusRef} size={20} aria-hidden />
          Save
        </motion.button>
        )}

        {!immersive && (
        <nav className="tabbar" aria-label="Main">
          <div className="tabbar__inner">
            {TABS.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className="tabbar__item" onClick={() => tick()}>
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        className="tabbar__pill"
                        layoutId="tabbar-pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        aria-hidden
                      />
                    )}
                    <motion.span
                      className="tabbar__label"
                      whileTap={{ scale: 0.92 }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                    >
                      <TabIcon Icon={Icon} active={isActive} />
                      {label}
                    </motion.span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
        )}

        {askSeed && <AskSheet seed={askSeed} onClose={() => setAskSeed(null)} />}
        {saveOpen && <SaveSheet onClose={() => setSaveOpen(false)} />}
        {profileOpen && <ProfileSheet onClose={() => setProfileOpen(false)} />}
      </div>
    </AppContext.Provider>
  )
}
