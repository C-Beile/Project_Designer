import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'

// Shared editable-text-cell primitive, factored out for the P4 second family
// (ViewCanvasEditor/ContextEditor/DashboardEditor) so all three editors commit/revert scalar text
// edits identically to `EntityFieldsEditor.tsx`'s own inline version - same keyboard contract
// ("Fertig"-Kriterium 3: Enter commits, Escape reverts, Tab/blur commits, no mouse required).
// `EntityFieldsEditor.tsx` keeps its own copy rather than importing this one - out of scope for
// this agent to touch (see role brief's "additive, no shared files" guardrail); a later cleanup
// pass could de-duplicate the two once both exist.
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
