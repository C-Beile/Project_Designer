import { isMacPlatform } from '../core/shortcuts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { MenuDef, MenuItemDef } from './menuModel'
import { formatShortcut } from '../core/shortcuts'

// Classic desktop menu bar, operable without a mouse like the original: Alt or F10 opens the
// first menu, Alt+<letter> opens a menu directly, arrows move, Enter runs, Esc closes.

interface OpenState {
  menu: number
  item: number
  sub: number | null
}

function selectable(items: MenuItemDef[]): number[] {
  return items.map((it, i) => (it.kind === 'separator' ? -1 : i)).filter((i) => i >= 0)
}

function step(items: MenuItemDef[], from: number, dir: 1 | -1): number {
  const idx = selectable(items)
  if (idx.length === 0) return -1
  const pos = idx.indexOf(from)
  if (pos < 0) return dir === 1 ? idx[0] : idx[idx.length - 1]
  return idx[(pos + dir + idx.length) % idx.length]
}

export function MenuBar({ menus, onCommand }: { menus: MenuDef[]; onCommand: (item: MenuItemDef) => void }) {
  const [open, setOpen] = useState<OpenState | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const altAlone = useRef(false)

  const openMenu = useCallback((menu: number, item = -1) => {
    if (!restoreFocus.current && document.activeElement instanceof HTMLElement && !rootRef.current?.contains(document.activeElement)) {
      restoreFocus.current = document.activeElement
    }
    setOpen({ menu, item: item < 0 ? step(menus[menu].items, -1, 1) : item, sub: null })
  }, [menus])

  const close = useCallback((refocus = true) => {
    setOpen(null)
    if (refocus) restoreFocus.current?.focus?.()
    restoreFocus.current = null
  }, [])

  // Keeps DOM focus on the active entry so screen readers and the keyboard handler follow it.
  useEffect(() => {
    if (!open || !rootRef.current) return
    const selector =
      open.sub !== null
        ? `[data-menu-path="${open.menu}-${open.item}-${open.sub}"]`
        : open.item >= 0
          ? `[data-menu-path="${open.menu}-${open.item}"]`
          : `[data-menu-top="${open.menu}"]`
    rootRef.current.querySelector<HTMLElement>(selector)?.focus()
  }, [open])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Alt') {
        altAlone.current = true
        return
      }
      altAlone.current = false
      if (e.key === 'F10' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        if (open) close()
        else openMenu(0)
        return
      }
      // On macOS Alt+letter types special characters, so the menu mnemonics are a Windows habit only.
      if (!isMacPlatform() && e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
        const idx = menus.findIndex((m) => m.mnemonic === e.key.toLowerCase())
        if (idx >= 0) {
          e.preventDefault()
          openMenu(idx)
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Alt' && altAlone.current) {
        altAlone.current = false
        e.preventDefault()
        if (open) close()
        else openMenu(0)
      }
    }
    function onPointerDown(e: MouseEvent) {
      if (open && rootRef.current && !rootRef.current.contains(e.target as Node)) close(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [menus, open, openMenu, close])

  function activate(item: MenuItemDef) {
    if (!item.enabled || item.kind !== 'item') return
    close()
    onCommand(item)
  }

  function onMenuKeyDown(e: ReactKeyboardEvent) {
    if (!open) return
    const items = menus[open.menu].items
    const current = items[open.item]
    const subItems = current?.kind === 'submenu' ? current.children ?? [] : []
    const inSub = open.sub !== null
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        if (inSub) setOpen({ ...open, sub: step(subItems, open.sub!, dir) })
        else setOpen({ ...open, item: step(items, open.item, dir) })
        break
      }
      case 'ArrowRight':
        e.preventDefault()
        if (!inSub && current?.kind === 'submenu' && current.enabled && subItems.length > 0) {
          setOpen({ ...open, sub: step(subItems, -1, 1) })
        } else {
          openMenu((open.menu + 1) % menus.length)
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (inSub) setOpen({ ...open, sub: null })
        else openMenu((open.menu - 1 + menus.length) % menus.length)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (inSub) activate(subItems[open.sub!])
        else if (current?.kind === 'submenu') {
          if (current.enabled && subItems.length > 0) setOpen({ ...open, sub: step(subItems, -1, 1) })
        } else if (current) activate(current)
        break
      case 'Escape':
        e.preventDefault()
        if (inSub) setOpen({ ...open, sub: null })
        else close()
        break
      case 'Tab':
        e.preventDefault()
        break
    }
  }

  function renderItem(it: MenuItemDef, path: string, onHover: () => void, active: boolean, subOpen: boolean, subChildren?: ReactNode) {
    if (it.kind === 'separator') return <li key={it.id} role="separator" className="forge-menu-separator" />
    const role = it.check === 'checkbox' ? 'menuitemcheckbox' : it.check === 'radio' ? 'menuitemradio' : 'menuitem'
    return (
      <li
        key={it.id}
        role={role}
        tabIndex={-1}
        data-menu-path={path}
        aria-disabled={!it.enabled || undefined}
        aria-checked={it.check ? Boolean(it.checked) : undefined}
        aria-haspopup={it.kind === 'submenu' ? 'menu' : undefined}
        aria-expanded={it.kind === 'submenu' ? subOpen : undefined}
        title={it.hint}
        className={`forge-menu-item${active ? ' is-active' : ''}${it.enabled ? '' : ' is-disabled'}`}
        onMouseEnter={onHover}
        onClick={(e) => {
          e.stopPropagation()
          if (it.kind === 'item') activate(it)
        }}
      >
        <span className="forge-menu-check" aria-hidden="true">
          {it.checked ? (it.check === 'radio' ? '●' : '✓') : ''}
        </span>
        <span className="forge-menu-label">{it.label}</span>
        <span className="forge-menu-shortcut">{it.shortcut ? formatShortcut(it.shortcut) : ''}</span>
        <span className="forge-menu-arrow" aria-hidden="true">
          {it.kind === 'submenu' ? '▸' : ''}
        </span>
        {subChildren}
      </li>
    )
  }

  return (
    <div className="forge-menubar" role="menubar" aria-label="Main menu" ref={rootRef} onKeyDown={onMenuKeyDown}>
      {menus.map((m, mi) => {
        const isOpen = open?.menu === mi
        return (
          <div key={m.id} className="forge-menubar-entry">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              data-menu-top={mi}
              tabIndex={-1}
              className={`forge-menubar-title${isOpen ? ' is-open' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (isOpen ? close() : openMenu(mi))}
              onMouseEnter={() => {
                if (open && !isOpen) openMenu(mi)
              }}
            >
              {m.label}
            </button>
            {isOpen ? (
              <ul className="forge-menu" role="menu" aria-label={m.label}>
                {m.items.map((it, ii) => {
                  const active = open.item === ii
                  const subOpen = active && open.sub !== null
                  const sub =
                    it.kind === 'submenu' && active && it.enabled && (it.children?.length ?? 0) > 0 ? (
                      <ul className="forge-menu forge-submenu" role="menu" aria-label={it.label}>
                        {it.children!.map((c, ci) =>
                          renderItem(c, `${mi}-${ii}-${ci}`, () => setOpen({ menu: mi, item: ii, sub: ci }), open.sub === ci, false),
                        )}
                      </ul>
                    ) : undefined
                  return renderItem(it, `${mi}-${ii}`, () => setOpen({ menu: mi, item: ii, sub: null }), active, subOpen, sub)
                })}
              </ul>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
