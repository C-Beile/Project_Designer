import { useCallback, useEffect, useState } from 'react'

export type ThemeName = 'dark' | 'light'

const STORAGE_KEY = 'forge.theme'

// Night Owl (design-direction.md) is the confirmed dark palette; the light palette in tokens.css
// is Forge's own, not-yet-confirmed counterpart (p6-theming-notes.md). Defaulting to 'dark' means
// nobody sees the unconfirmed palette unless they deliberately switch to it.
function readStoredTheme(): ThemeName {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    // Private browsing / disabled storage - fall back to the default rather than failing the
    // whole app over a theme preference.
    return 'dark'
  }
}

/** Applies `data-theme` to <html> and persists the choice; returns the current theme + a toggle. */
export function useTheme(): [ThemeName, () => void] {
  const [theme, setTheme] = useState<ThemeName>(() => (typeof window === 'undefined' ? 'dark' : readStoredTheme()))

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* ignore - see readStoredTheme */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return [theme, toggle]
}
