// Thin, safety-gated wrapper around @tauri-apps/api/window for the custom titlebar
// (chrome/TitleBar.tsx). Two environments load this module without a real Tauri host:
//   - vitest/jsdom (App.test.tsx renders <App>, which renders <TitleBar>)
//   - `npm run dev` opened directly in a plain browser tab while iterating on styles
// `@tauri-apps/api/window`'s `getCurrentWindow()` dereferences `window.__TAURI_INTERNALS__`
// synchronously and throws if it is missing, so every call here is gated behind
// `isTauriRuntime()` first and the module itself is only dynamically imported once that check
// has already passed - neither environment above ever touches the real Tauri API surface.

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function currentWindow() {
  if (!isTauriRuntime()) return null
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

export async function minimizeWindow(): Promise<void> {
  const w = await currentWindow()
  await w?.minimize().catch(() => {})
}

export async function toggleMaximizeWindow(): Promise<void> {
  const w = await currentWindow()
  await w?.toggleMaximize().catch(() => {})
}

export async function closeWindow(): Promise<void> {
  const w = await currentWindow()
  await w?.close().catch(() => {})
}

/**
 * Best-effort read of the current maximized state, used only to pick the right icon on the
 * restore/maximize button after a click. Not kept live-in-sync with OS-level changes (e.g. a
 * double-click on the drag region, or a Windows snap gesture) - see p6-theming-notes.md for why
 * that was left as an open point rather than wiring an onResized listener this round.
 */
export async function queryMaximized(): Promise<boolean | null> {
  const w = await currentWindow()
  if (!w) return null
  try {
    return await w.isMaximized()
  } catch {
    return null
  }
}

/**
 * Subscribes to the OS-level window focus/blur state so the custom titlebar (chrome/TitleBar.tsx)
 * can dim itself the same way a native title bar does - tokens.css already ships
 * `--bg-titlebar-inactive`/`--fg-titlebar-inactive` for exactly this (sourced from Night Owl's own
 * `titleBar.inactiveBackground`), this wires them up instead of leaving them unused. Calls
 * `onChange` with the initial state immediately, then on every subsequent OS focus/blur event.
 * Outside Tauri (vitest/plain browser preview) this is a no-op beyond the initial `true` callback,
 * matching the rest of this module's safety pattern.
 */
export async function watchWindowFocus(onChange: (focused: boolean) => void): Promise<() => void> {
  if (!isTauriRuntime()) {
    onChange(true)
    return () => {}
  }
  const w = await currentWindow()
  if (!w) {
    onChange(true)
    return () => {}
  }
  try {
    onChange(await w.isFocused())
  } catch {
    onChange(true)
  }
  try {
    return await w.onFocusChanged(({ payload: focused }) => onChange(focused))
  } catch {
    return () => {}
  }
}
