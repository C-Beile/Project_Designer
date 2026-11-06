import { useCallback, useEffect, useState } from 'react'
import { getOptions, subscribeOptions } from '../settings/options'
import { findCustomTheme, subscribeCustomThemes } from './customThemes'
import { applyUiTheme } from './uiTheme'

export type ThemeName = 'dark' | 'light' | 'lion'

export const THEME_LABELS: Record<ThemeName, string> = { dark: 'Dark (Night Owl)', light: 'Light', lion: 'Lion in der City' }

const STORAGE_KEY = 'forge.theme'

// Night Owl (design-direction.md) is the confirmed dark palette; the light palette in tokens.css
// is Forge's own, not-yet-confirmed counterpart (p6-theming-notes.md). Defaulting to 'dark' means
// nobody sees the unconfirmed palette unless they deliberately switch to it.
function readStoredTheme(): ThemeName {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'lion' ? stored : 'dark'
  } catch {
    // Private browsing / disabled storage - fall back to the default rather than failing the
    // whole app over a theme preference.
    return 'dark'
  }
}

/** Applies `data-theme` to <html> and persists the choice; returns the current theme and a setter. Without an argument the setter flips between dark and light. */
export function useTheme(): [ThemeName, (next?: ThemeName) => void] {
  const [theme, setTheme] = useState<ThemeName>(() => (typeof window === 'undefined' ? 'dark' : readStoredTheme()))

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* ignore - see readStoredTheme */
    }
  }, [theme])

  // An imported colour theme colours the whole interface, not only the editor.
  const [themeStamp, setThemeStamp] = useState(0)
  useEffect(() => {
    const bump = () => setThemeStamp((n) => n + 1)
    const offOptions = subscribeOptions(bump)
    const offThemes = subscribeCustomThemes(bump)
    return () => {
      offOptions()
      offThemes()
    }
  }, [])
  const chosen = getOptions().editor.colorTheme
  useEffect(() => {
    applyUiTheme(chosen ? findCustomTheme(chosen)?.data : undefined, theme)
  }, [chosen, theme, themeStamp])

  const toggle = useCallback((next?: ThemeName) => setTheme((t) => next ?? (t === 'dark' ? 'light' : 'dark')), [])

  return [theme, toggle]
}
