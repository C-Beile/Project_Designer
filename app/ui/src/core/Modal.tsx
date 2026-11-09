import { useContext, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { OsWindowContext } from '../windows/osWindowContext'

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled])'

// The one dialog frame of the app. Escape closes only the top dialog, Tab stays inside it, Enter
// runs the default action (`onEnter`, never inside multi-line fields or on other buttons) and the
// focus returns to where it was when the dialog closes.
export function Modal({ title, onClose, children, footer, onEnter }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; onEnter?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const inWindow = useContext(OsWindowContext)
  // The confirming button of every dialog (OK, Save, Deploy ...) is drawn as the primary one.
  useEffect(() => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.forge-modal-footer button') ?? [])]
    if (buttons.some((b) => b.classList.contains('is-primary'))) return
    buttons.find((b) => /^(OK|Save|Deploy|Update|Apply|Open|Finish|Create|Commit|Yes|Delete|Install and restart|Export|Import|Add|Connect)\b/i.test(b.textContent?.trim() ?? ''))?.classList.add('is-primary')
  })
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.querySelector<HTMLElement>('input, button, select')?.focus()
    return () => previous?.focus?.()
  }, [])
  return (
    <div className={inWindow ? 'forge-os-dialog-frame' : 'forge-modal-backdrop'}>
      <div
        className={inWindow ? 'forge-os-dialog' : 'forge-modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
            return
          }
          if (e.key === 'Enter' && onEnter && !e.defaultPrevented) {
            const tag = (e.target as HTMLElement).tagName
            if (tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'SELECT') {
              e.preventDefault()
              e.stopPropagation()
              onEnter()
            }
            return
          }
          if (e.key === 'Tab' && ref.current) {
            const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
            if (items.length === 0) return
            if (e.shiftKey && document.activeElement === items[0]) {
              e.preventDefault()
              items[items.length - 1].focus()
            } else if (!e.shiftKey && document.activeElement === items[items.length - 1]) {
              e.preventDefault()
              items[0].focus()
            }
          }
        }}
      >
        {inWindow ? null : <header className="forge-modal-title">{title}</header>}
        <div className="forge-modal-body">{children}</div>
        <footer className="forge-modal-footer">{footer}</footer>
      </div>
    </div>
  )
}
