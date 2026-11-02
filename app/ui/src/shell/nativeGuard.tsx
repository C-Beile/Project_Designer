import { useEffect, useState } from 'react'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'

// The WebView2 browser menu (Back, Reload, Save as, Print, More tools) must never appear in the
// app. Every right click is swallowed here; text inputs get an own Cut/Copy/Paste/Select All menu,
// Monaco keeps its own editor menu, and areas with a menu of their own handle the event earlier.
// In release builds the browser shortcuts for developer tools and reloading are blocked as well.

export type TextField = HTMLInputElement | HTMLTextAreaElement

export function textFieldOf(target: EventTarget | null): TextField | null {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return null
  if (el.closest('.monaco-editor')) return null
  if (el instanceof HTMLTextAreaElement) return el
  if (el instanceof HTMLInputElement) {
    const textual = ['text', 'search', 'password', 'email', 'url', 'tel', 'number', ''].includes(el.type)
    return textual ? el : null
  }
  return null
}

export function isBlockedBrowserKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'metaKey'>): boolean {
  const k = e.key.toLowerCase()
  if (k === 'f12' || k === 'f5') return true
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) return true
  if (mod && !e.shiftKey && (k === 'r' || k === 'u')) return true
  if (mod && e.shiftKey && k === 'r') return true
  return false
}

export function textMenuEntries(field: TextField): MenuEntry[] {
  const hasSelection = (field.selectionStart ?? 0) !== (field.selectionEnd ?? 0)
  const editable = !field.readOnly && !field.disabled
  const none = 'Nothing selected'
  return [
    { id: 'cut', label: 'Cut', enabled: hasSelection && editable, hint: editable ? none : 'The field is read-only' },
    { id: 'copy', label: 'Copy', enabled: hasSelection && field.type !== 'password', hint: field.type === 'password' ? 'Not available for passwords' : none },
    { id: 'paste', label: 'Paste', enabled: editable, hint: 'The field is read-only' },
    { id: 'sep', label: '', enabled: false, separator: true },
    { id: 'all', label: 'Select All', enabled: field.value.length > 0, hint: 'The field is empty' },
  ]
}

async function runTextAction(field: TextField, id: string): Promise<void> {
  field.focus()
  if (id === 'all') field.select()
  else if (id === 'cut') document.execCommand('cut')
  else if (id === 'copy') document.execCommand('copy')
  else if (id === 'paste') {
    const text = await navigator.clipboard?.readText?.().catch(() => '')
    if (text) document.execCommand('insertText', false, text)
  }
}

export function NativeMenuGuard({ release = import.meta.env.PROD }: { release?: boolean }) {
  const [menu, setMenu] = useState<{ field: TextField; x: number; y: number } | null>(null)

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      const handled = e.defaultPrevented
      e.preventDefault()
      if (handled) return
      const field = textFieldOf(e.target)
      if (field) setMenu({ field, x: e.clientX, y: e.clientY })
    }
    const onKey = (e: KeyboardEvent) => {
      if (release && isBlockedBrowserKey(e)) e.preventDefault()
    }
    document.addEventListener('contextmenu', onContext)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('contextmenu', onContext)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [release])

  if (!menu) return null
  return <TreeContextMenu entries={textMenuEntries(menu.field)} x={menu.x} y={menu.y} onPick={(id) => void runTextAction(menu.field, id)} onClose={() => setMenu(null)} />
}
