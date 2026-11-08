import { isMacPlatform } from '../core/shortcuts'
import { useCallback, useEffect, useState } from 'react'
import appIcon64 from '../assets/brand/app-icon-64.png'
import {
  closeWindow,
  isTauriRuntime,
  minimizeWindow,
  queryMaximized,
  toggleMaximizeWindow,
  watchWindowFocus,
} from './tauriWindow'

// The fix for the one hard MUST from ui-reference-car-training.md's photo review: the real ADITO
// Designer leaves its native titlebar/menubar light while the rest of the app is dark - an
// unintended style break. `tauri.conf.json` now sets `"decorations": false`, so Tauri draws NO
// native chrome at all for the main window; this component is the *entire* replacement, themed
// through the same tokens.css every editor uses, so there is no native seam left to fall out of
// sync with the app theme. `data-tauri-drag-region` is handled natively by the Tauri webview
// bridge (drag-to-move, double-click-to-maximize) without any JS on our side. The theme switch moved
// to View > Theme (P8), so the title bar carries only the window name and window buttons.

export function TitleBar({ title = 'Dito Designer' }: { title?: string }) {
  const [maximized, setMaximized] = useState(false)
  const [focused, setFocused] = useState(true)

  const syncMaximized = useCallback(() => {
    queryMaximized().then((m) => {
      if (m !== null) setMaximized(m)
    })
  }, [])

  useEffect(() => {
    syncMaximized()
  }, [syncMaximized])

  // Dims the titlebar to the theme's `*-titlebar-inactive` tokens when the OS reports the window
  // has lost focus - the same "active vs. inactive window" cue every native title bar gives, now
  // themed instead of falling back to unstyled OS chrome (see tauriWindow.ts::watchWindowFocus).
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    watchWindowFocus((f) => {
      if (!cancelled) setFocused(f)
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  async function handleMinimize() {
    await minimizeWindow()
  }

  async function handleToggleMaximize() {
    await toggleMaximizeWindow()
    await syncMaximized()
  }

  async function handleClose() {
    await closeWindow()
  }

  // macOS keeps its native title bar with the traffic-light buttons (see tauri.macos.conf.json);
  // drawing a second bar with Windows-style buttons would only duplicate it.
  if (isMacPlatform()) return null

  return (
    <header className="forge-titlebar" data-tauri-drag-region data-window-focused={focused}>
      <div className="forge-titlebar-brand" data-tauri-drag-region>
        <img className="forge-titlebar-logo" src={appIcon64} alt="" aria-hidden="true" />
        <span className="forge-titlebar-title">{title}</span>
      </div>
      <div className="forge-titlebar-spacer" data-tauri-drag-region />
      {isTauriRuntime() && (
        <div className="forge-titlebar-controls">
          <button type="button" className="forge-titlebar-btn" aria-label="Minimize window" onClick={handleMinimize}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            type="button"
            className="forge-titlebar-btn"
            aria-label={maximized ? 'Restore window' : 'Maximize window'}
            onClick={handleToggleMaximize}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
                <rect x="0" y="2" width="8" height="8" fill="var(--bg-titlebar)" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0" y="0" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="forge-titlebar-btn forge-titlebar-close"
            aria-label="Close window"
            onClick={handleClose}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
              <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      )}
    </header>
  )
}
