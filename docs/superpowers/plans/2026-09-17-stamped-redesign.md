# Stamped Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the TripStash PWA in the "Stamped" editorial direction with real motion, then capture light/dark screenshots of every screen.

**Architecture:** Tokens and the stylesheet are rewritten first, then four new primitives (Stamp, Drawer, Segmented, Money) plus the animated icon set are added, then each screen is restyled against those primitives. The API, routes, data hooks and offline behaviour are untouched.

**Tech Stack:** React 18, Vite 5, TypeScript, `motion` (framer-motion), `vaul`, `@number-flow/react`, `clsx`, Leaflet, Lucide + `pqoqubbw/icons`.

**Spec:** `docs/superpowers/specs/2026-09-17-stamped-redesign-design.md`

## Global Constraints

- One typeface: Bricolage Grotesque variable, self-hosted at `web/public/fonts/BricolageGrotesque-var.woff2`.
- Palette exactly as the spec's colour table; status is never colour-only.
- Springs: UI `{stiffness:420, damping:34}`, stamp `{stiffness:260, damping:20}`; nothing longer than 400ms; `useReducedMotion()` disables every spring.
- 44px minimum targets; visible `:focus-visible` rings; list alternative to the map stays.
- `cd web && npm run lint && npm run build` must pass after every task.
- Commit after every task on branch `redesign`.

---

### Task 1: Dependencies, font, tokens

**Files:**
- Modify: `web/package.json`
- Create: `web/public/fonts/BricolageGrotesque-var.woff2`
- Modify: `web/index.html` (preload + theme-color)
- Rewrite: `web/src/styles/theme.css`

**Interfaces:**
- Produces: CSS custom properties named in the spec (`--paper`, `--ink`, `--teal`, `--coral`, `--gold`, `--display`, `--title`, `--head`, `--body`, `--small`, `--stamp`, `--r-*`, `--shadow-float`, `--spring` is JS-only).

- [ ] **Step 1:** `cd web && npm i motion vaul @number-flow/react clsx`
- [ ] **Step 2:** Download the variable font from Google Fonts' GitHub (`googlefonts/bricolage-grotesque`, `fonts/variable/BricolageGrotesque[opsz,wdth,wght].ttf`), convert or fetch the woff2 from the Google Fonts CSS API, save as `web/public/fonts/BricolageGrotesque-var.woff2`; delete the Jakarta file.
- [ ] **Step 3:** Rewrite `theme.css` with the token table from the spec (light `:root`, dark under `prefers-color-scheme` and `[data-theme]`).
- [ ] **Step 4:** Update `index.html` preload href and `theme-color` metas (`#F4F7F2` / `#0B1716`).
- [ ] **Step 5:** `npm run lint && npm run build` → pass. Commit `feat(web): Stamped tokens and Bricolage Grotesque`.

### Task 2: Stylesheet rewrite

**Files:**
- Rewrite: `web/src/styles/app.css`

**Interfaces:**
- Produces the class vocabulary every screen uses: `.screen .pad .row .stack .hero .hero__title .hero__line .list .item .item__title .meta .glyph .glyph--{food|stay|nature|view|transport|other} .card .card--stamp .btn .btn--ink .btn--coral .btn--ghost .btn--sm .icon-btn .chip .chip--on .rail .timeline .timeline__dot .stepper .searchbar .tabbar .tabbar__item .tabbar__pill .fab .drawer .drawer__grip .map-* .minimap .hero-map .field .input .banner .note .empty .skeleton .sr-only .stamp .stamp--{status} .arc`.

- [ ] **Step 1:** Write base, type utilities, layout, hero, lists, glyph tints, cards, controls, chips, segmented, timeline, stepper, tab bar, FAB, drawer (vaul `[data-vaul-drawer]` styles), map, minimap/hero-map duotone, forms, feedback, stamp ring (`.stamp` = inline-flex ring with 2px border, rotate(-6deg), `mask-image: radial-gradient(...)` for ink texture), arc.
- [ ] **Step 2:** `npm run build` → pass (unused classes are fine). Commit `feat(web): Stamped stylesheet`.

### Task 3: Motion primitives and animated icons

**Files:**
- Create: `web/src/lib/cn.ts` — `export const cn = (...a: (string|false|null|undefined)[]) => clsx(a)`
- Create: `web/src/lib/motion.ts` — `SPRING`, `SPRING_STAMP`, `useMotionPrefs()` returning `{ reduced, spring, stamp }` where reduced → `{duration: 0}`.
- Create: `web/src/components/motion/` — download from `https://raw.githubusercontent.com/pqoqubbw/icons/main/icons/<name>.tsx` for: home, map-pin, bookmark, briefcase-business, sparkles, plus, check, x, compass, airplane, refresh-cw, search, wallet, cloud-sun, send, upload, loader-circle, heart, calendar-days. Replace `@/lib/utils` → `../../lib/cn`, drop `"use client"`.
- Create: `web/src/components/motion/index.ts` re-exporting them.
- Create: `web/src/components/Stamp.tsx`

**Interfaces:**
- `Stamp({ label, tone?: 'ink'|'teal'|'coral'|'gold'|'muted', Icon?, size?: 'sm'|'md'|'lg', rotate?: number })` renders the ring.
- `StampDrop({ label, tone, show: boolean })` — `AnimatePresence` scale 1.8→1, rotate −18→−6, spring stamp.
- `STATUS_STAMP: Record<PlaceStatus, {label, tone, Icon}>` (replaces `STATUS_META`).

- [ ] **Step 1:** Write `cn.ts`, `motion.ts`.
- [ ] **Step 2:** Fetch icons with curl into `components/motion/`, sed the import path, write `index.ts`.
- [ ] **Step 3:** Write `Stamp.tsx`.
- [ ] **Step 4:** `npm run lint && npm run build` → pass. Commit `feat(web): stamp primitive and animated icons from pqoqubbw/icons`.

### Task 4: Drawer, Segmented, Money primitives; ui.tsx update

**Files:**
- Create: `web/src/components/Drawer.tsx` — vaul wrapper: `Drawer({ title, onClose, children, snapPoints? })`, always open, `onOpenChange(false)` → `onClose`.
- Create: `web/src/components/Segmented.tsx` — `Segmented<T>({ value, onChange, options: {value:T,label:string,badge?:number}[], label })` with `motion.span layoutId` pill.
- Create: `web/src/components/Money.tsx` — `MoneyFigure({ amount, currency, size?: 'lg'|'xl' })` using `NumberFlow`; `BudgetArc({ spent, budget })` SVG arc with `motion.path` `pathLength` 0→ratio.
- Modify: `web/src/components/ui.tsx` — keep `pairText`, `Meta`, `Glyph` (add `tone` from category), `Note`, `Banner`, `Empty`, `SkeletonRows`, `ErrorNote`, `CacheNote`, `Freshness` (amber stamp when not fresh), `Confidence` (slim bar); replace `StatusLabel` with `<Stamp size="sm" {...STATUS_STAMP[status]}/>`; `Tabs` → delegate to `Segmented`; `Sheet` → delegate to `Drawer`; `Pill` → `.chip`.

- [ ] **Step 1:** Write the three components.
- [ ] **Step 2:** Update `ui.tsx`; keep exported names so pages compile before they are restyled.
- [ ] **Step 3:** `npm run lint && npm run build` → pass. Commit `feat(web): drawer, segmented control, money figures`.

### Task 5: App shell — tab bar, FAB, route transitions, TopBar

**Files:**
- Modify: `web/src/App.tsx`, `web/src/components/TopBar.tsx`, `web/src/main.tsx` (MotionConfig reducedMotion="user")

- [ ] **Step 1:** Tab bar: 4 items, active gets `motion.span.tabbar__pill layoutId="tab"`; icons from `components/motion` triggered via ref on tap.
- [ ] **Step 2:** FAB: `motion.button` coral, `whileTap={{scale:.94}}`, label "Save".
- [ ] **Step 3:** Routes wrapped in `AnimatePresence mode="wait"` with a `Page` wrapper (`motion.div` opacity/y).
- [ ] **Step 4:** TopBar: compact sticky bar used by Saved/Trip/Place-scrolled; Home uses the hero instead.
- [ ] **Step 5:** lint + build; commit `feat(web): animated shell`.

### Task 6: Login and NewTrip
- [ ] Login: contour SVG background (`Contours` component, 6 paths, `motion.g` translate loop 40s unless reduced), stacked wordmark, bottom card form.
- [ ] NewTrip: same background, form card.
- [ ] lint + build; commit `feat(web): Stamped login`.

### Task 7: Home
- [ ] Hero (`.hero`): destination in `--display`, line 2 phase/day/weather with gold chip.
- [ ] Review-queue stamp card, Today timeline, Brought-back rail (cards with category stamp), Money (`MoneyFigure` + `BudgetArc`), bookings, counts.
- [ ] Stagger rows with `motion.li` variants.
- [ ] lint + build; commit `feat(web): Home`.

### Task 8: Saved + ReviewCard
- [ ] `Segmented` tabs; Inbox cards with quote block, confidence bar, `StampDrop` on approve then collapse (`AnimatePresence` on the list item); Ignore slides out.
- [ ] Places rows with status stamp; Knowledge and Sources restyled.
- [ ] lint + build; commit `feat(web): Saved and stamp approve`.

### Task 9: Map
- [ ] Tiles: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png` light, `dark_all` dark (attribution `© OpenStreetMap © CARTO`), switch on `matchMedia`.
- [ ] Stamp pins (`.pin`), selected pin `.pin--active` with ring pulse.
- [ ] Sheet → vaul `Drawer` with `snapPoints=[0.28,0.55,0.92]`, `modal={false}`; keep `--sheet-h` sync from `activeSnapPoint`.
- [ ] lint + build; commit `feat(web): Map`.

### Task 10: Place
- [ ] `.hero-map` 240px with duotone overlay; title overlapping; status stamp top-right; sticky compact bar via `useScroll`.
- [ ] Sections restyled; status chips → stamps in a rail; visits/plan lists.
- [ ] lint + build; commit `feat(web): Place`.

### Task 11: Trip, Ask, Save
- [ ] Trip: hero title, route `.stepper`, Money mirrors Home, forms restyled.
- [ ] Ask/Save: `Drawer`; Ask answer reveal via `motion.span` per word (cap 40 words animated); Save modes via `Segmented`, success card with `Stamp label="Saved"`.
- [ ] lint + build; commit `feat(web): Trip, Ask, Save`.

### Task 12: Docs, screenshots, push
- [ ] Rewrite `docs/design.md` for the new system; update README screenshot section.
- [ ] Run API (`uvicorn app.main:app --port 8000`) and `npm run dev`; Playwright at 390×844: login, home, map, saved (inbox + places), place, trip, ask, save — light and dark → `docs/screenshots/<screen>-<theme>.png`.
- [ ] Commit `docs: screenshots`; `git push -u origin redesign`.
