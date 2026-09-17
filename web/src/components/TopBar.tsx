import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../lib/context'
import { cn } from '../lib/cn'
import { SparklesIcon, type SparklesIconHandle } from './motion'

/**
 * Compact sticky title bar for inner screens.
 *
 * Ask sits here rather than on a floating button, so the assistant is next to
 * the context it inherits instead of hovering over unrelated content. Home
 * and Trip use the editorial hero instead and pass `ask` through AskButton.
 */
export default function TopBar({
  title,
  subtitle,
  leading,
  actions,
  ask = true,
}: {
  title: string
  subtitle?: string
  leading?: ReactNode
  actions?: ReactNode
  ask?: boolean
}) {
  const [divided, setDivided] = useState(false)
  useEffect(() => {
    const onScroll = () => setDivided(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header className={cn('topbar', divided && 'topbar--divided')}>
      {leading}
      <div className="grow" style={{ minWidth: 0 }}>
        <h1 className="topbar__title clamp-1">{title}</h1>
        {subtitle && <p className="meta clamp-1">{subtitle}</p>}
      </div>
      {actions}
      {ask && <AskButton />}
    </header>
  )
}

export function AskButton({ tone = 'ink' }: { tone?: 'ink' | 'ghost' }) {
  const { openAsk } = useApp()
  const ref = useRef<SparklesIconHandle>(null)
  return (
    <button
      className={cn('btn btn--sm', tone === 'ink' ? 'btn--ink' : 'btn--ghost')}
      onClick={() => openAsk()}
      onPointerEnter={() => ref.current?.startAnimation()}
      onPointerLeave={() => ref.current?.stopAnimation()}
    >
      <SparklesIcon ref={ref} size={16} aria-hidden />
      Ask
    </button>
  )
}
