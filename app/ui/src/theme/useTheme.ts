import { useCallback, useEffect, useRef, useState } from 'react'
import { getOptions, saveOptions, subscribeOptions } from '../settings/options'
import { isPluginActive, subscribePluginPrefs } from '../settings/plugins'
import { findCustomTheme, subscribeCustomThemes } from './customThemes'
import { applyUiTheme } from './uiTheme'
import { applyColorOverrides, subscribeColorOverrides } from './colorOverrides'

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

  // The Options window (another window) changed the choice and Apply keeps it open: follow it right away.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTheme(readStoredTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // An imported colour theme colours the whole interface, not only the editor.
  const [themeStamp, setThemeStamp] = useState(0)
  useEffect(() => {
    const bump = () => setThemeStamp((n) => n + 1)
    const offOptions = subscribeOptions(bump)
    const offThemes = subscribeCustomThemes(bump)
    const offColors = subscribeColorOverrides(bump)
    const offPlugins = subscribePluginPrefs(bump)
    return () => {
      offOptions()
      offThemes()
      offColors()
      offPlugins()
    }
  }, [])
  // A VS Code theme only counts while the import plugin is on; switching the plugin off brings the standard theme back.
  const importOn = isPluginActive('vscode-themes')
  const chosen = importOn ? getOptions().editor.colorTheme : ''
  const wasOn = useRef(importOn)
  useEffect(() => {
    if (wasOn.current && !importOn && getOptions().editor.colorTheme) {
      saveOptions({ ...getOptions(), editor: { ...getOptions().editor, colorTheme: '' } })
      setTheme('dark')
    }
    wasOn.current = importOn
  }, [importOn])
  useEffect(() => {
    applyUiTheme(chosen ? findCustomTheme(chosen)?.data : undefined, theme)
    // The colours the user set by hand lie on top of the theme.
    applyColorOverrides()
  }, [chosen, theme, themeStamp])

  const toggle = useCallback((next?: ThemeName) => setTheme((t) => next ?? (t === 'dark' ? 'light' : 'dark')), [])

  return [theme, toggle]
}
