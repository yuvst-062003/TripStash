import { useState, type ReactNode } from 'react'
import { Drawer as Vaul } from 'vaul'
import { X } from './icons'

/**
 * Bottom sheet with real drag physics (vaul).
 *
 * Mounted open; closing plays the slide-out first and only then tells the
 * parent to unmount, so the sheet never just vanishes.
 */
export default function Drawer({
  title,
  onClose,
  children,
  action,
  description,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  action?: ReactNode
  description?: string
}) {
  const [open, setOpen] = useState(true)
  return (
    <Vaul.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false)
      }}
      onAnimationEnd={(next) => {
        if (!next) onClose()
      }}
      repositionInputs={false}
    >
      <Vaul.Portal>
        <Vaul.Overlay className="drawer-overlay" />
        <Vaul.Content className="drawer" aria-describedby={undefined}>
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
