import { useEffect, useRef, useState } from 'react'
import type { NewObjectKind } from '../wire/types'

// Type chooser of "Create New Model": a drop-down list whose entries carry the colour square of the
// folder type, as in the tree, so the type is recognised at a glance. Types that cannot be created
// yet stay visible but dimmed, with the reason as tooltip.

const swatch = (folder: string) => ({ background: `var(--folder-${folder}, var(--folder-plain))` })

export function TypeCombo({ kinds, value, onChange }: { kinds: NewObjectKind[]; value: string | null; onChange: (folder: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = kinds.find((k) => k.folder === value) ?? null

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const pick = (k: NewObjectKind) => {
    if (!k.enabled) return
    onChange(k.folder)
    setOpen(false)
  }

  const step = (dir: 1 | -1) => {
    const list = kinds.filter((k) => k.enabled)
    const at = list.findIndex((k) => k.folder === value)
    const next = list[Math.min(list.length - 1, Math.max(0, at + dir))]
    if (next) onChange(next.folder)
  }

  return (
    <div className="type-combo" ref={root}>
      <button
        type="button"
        role="combobox"
        aria-label="Object type"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="type-combo-button"
        data-value={value ?? ''}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (open) step(1)
            else setOpen(true)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            step(-1)
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      >
        {current ? <span className="type-swatch" style={swatch(current.folder)} /> : null}
        <span className="type-combo-label">{current?.label ?? ''}</span>
        <svg className="type-combo-chevron" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <ul className="type-combo-list" role="listbox" aria-label="Object types">
          {kinds.map((k) => (
            <li
              key={k.folder}
              role="option"
              aria-selected={k.folder === value}
              aria-disabled={!k.enabled}
              title={k.hint ?? undefined}
              className={`type-combo-option${k.folder === value ? ' is-selected' : ''}${k.enabled ? '' : ' is-disabled'}`}
              onClick={() => pick(k)}
            >
              <span className="type-swatch" style={swatch(k.folder)} />
              {k.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
