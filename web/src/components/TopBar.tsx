import type { ReactNode } from 'react'
import { useApp } from '../lib/context'
import { Sparkles } from './icons'

/**
 * Screen title bar.
 *
 * Ask sits here rather than on a floating button, so the assistant is next to
 * the context it inherits instead of hovering over unrelated content.
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
  const { openAsk } = useApp()
  return (
    <header className="topbar">
      {leading}
      <div className="grow" style={{ minWidth: 0 }}>
        <h1 className="t-lg clamp-1">{title}</h1>
        {subtitle && <p className="meta clamp-1">{subtitle}</p>}
      </div>
      {actions}
      {ask && (
        <button className="btn btn--sm" onClick={() => openAsk()}>
          <Sparkles size={15} strokeWidth={2.1} />
          Ask
        </button>
      )}
    </header>
  )
}
