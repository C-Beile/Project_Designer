import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'

// Gemeinsame Text-Zelle für ViewCanvasEditor, ContextEditor und DashboardEditor. Tastenlogik: Enter speichert, Escape verwirft, Tab und Blur speichern, ohne Maus.
export function EditableText({
  value,
  onCommit,
  ariaLabel,
  masked,
  disabled,
  title,
}: {
  value: string
  onCommit: (next: string) => void
  ariaLabel: string
  /** Passwords are drawn as dots; the text is still editable. */
  masked?: boolean
  /** Shown but not editable; `title` says why. */
  disabled?: boolean
  title?: string
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  function commit() {
    if (draft !== value) onCommit(draft)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(value)
    }
  }

  return (
    <input
      aria-label={ariaLabel}
      type={masked ? 'password' : 'text'}
      readOnly={disabled}
      title={title}
      autoComplete="off"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  )
}
