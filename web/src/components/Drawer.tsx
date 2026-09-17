import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Drawer as Vaul } from 'vaul'
import { cn } from '../lib/cn'
import { X } from './icons'

/**
 * Bottom sheet with real drag physics (vaul).
 *
 * Mounted open; closing plays the slide-out first and only then tells the
 * parent to unmount, so the sheet never just vanishes. Focus comes back to
 * whatever opened it.
 */
export default function Drawer({
  title,
  onClose,
  children,
  action,
  description,
  className,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  action?: ReactNode
  description?: string
  /** `drawer--tall` fixes the height for content that changes size (the assistant). */
  className?: string
}) {
  const [open, setOpen] = useState(true)
  // Children rise in as the sheet lands; after that they just change.
  const [settled, setSettled] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    const id = window.setTimeout(() => setSettled(true), 450)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <Vaul.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false)
      }}
      onAnimationEnd={(next) => {
        if (!next) {
          opener.current?.focus?.()
          onClose()
        }
      }}
      repositionInputs={false}
    >
      <Vaul.Portal>
        <Vaul.Overlay className="drawer-overlay" />
        <Vaul.Content
          className={cn('drawer', settled && 'drawer--settled', className)}
          aria-describedby={undefined}
        >
          <div className="drawer__grip" aria-hidden />
          <div className="drawer__head">
            <Vaul.Title className="drawer__title grow clamp-1">{title}</Vaul.Title>
            {description ? (
              <Vaul.Description className="sr-only">{description}</Vaul.Description>
            ) : (
              <Vaul.Description className="sr-only">{title}</Vaul.Description>
            )}
            {action}
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              <X size={20} />
            </button>
          </div>
          <div className="drawer__body">{children}</div>
        </Vaul.Content>
      </Vaul.Portal>
    </Vaul.Root>
  )
}
