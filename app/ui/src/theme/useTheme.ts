import { useCallback, useEffect, useRef, useState } from 'react'
import { configGet, configSet, onConfigChange, touches } from '../settings/appConfig'
import { getOptions, saveOptions, subscribeOptions } from '../settings/options'
import { isPluginActive, subscribePluginPrefs } from '../settings/plugins'
import { findCustomTheme, subscribeCustomThemes } from './customThemes'
import { applyUiTheme } from './uiTheme'
import { BUILTIN_TOML_THEMES } from './builtinThemes'
import { applyThemeTokens } from './themeToml'
import { findUserTheme, subscribeThemes, USER_THEME_PATH } from './themeStore'
import { setActiveEditorTheme } from './editorTheme'

export type ThemeName = 'dark' | 'light' | 'lion'

export const THEME_LABELS: Record<ThemeName, string> = { dark: 'Dark (Night Owl)', light: 'Light', lion: 'Lion in der City' }

const THEME_PATH = ['appearance', 'theme'] as const

// Während des Umbaus ist Lion in der City der Standard (docs/ui-refactor-plan.md). Night Owl und Light folgen am Schluss.
function readStoredTheme(): ThemeName {
  const stored = configGet<string>(...THEME_PATH)
  return stored === 'light' || stored === 'dark' ? stored : 'lion'
}

/** Applies `data-theme` to <html> and persists the choice; returns the current theme and a setter. Without an argument the setter flips between dark and light. */
export function useTheme(): [ThemeName, (next?: ThemeName) => void] {
  const [theme, setTheme] = useState<ThemeName>(() => (typeof window === 'undefined' ? 'dark' : readStoredTheme()))

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // Der Standard (lion) steht nicht in der Datei: ein leerer Wert fehlt einfach.
    configSet(THEME_PATH, theme === 'lion' ? undefined : theme)
  }, [theme])

  // The Options window (another window) changed the choice and Apply keeps it open: follow it right away.
  useEffect(() => {
    return onConfigChange((path) => {
      if (touches(path, THEME_PATH)) setTheme(readStoredTheme())
      if (touches(path, USER_THEME_PATH)) setThemeStamp((n) => n + 1)
    })
  }, [])

  // An imported colour theme colours the whole interface, not only the editor.
  const [themeStamp, setThemeStamp] = useState(0)
  useEffect(() => {
    const bump = () => setThemeStamp((n) => n + 1)
    const offOptions = subscribeOptions(bump)
    const offThemes = subscribeCustomThemes(bump)
    const offPlugins = subscribePluginPrefs(bump)
    const offUserThemes = subscribeThemes(bump)
    return () => {
      offOptions()
      offThemes()
      offPlugins()
      offUserThemes()
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
    const user = chosen ? undefined : findUserTheme(configGet<string>(...USER_THEME_PATH))?.parsed
    applyUiTheme(chosen ? findCustomTheme(chosen)?.data : undefined, user ? user.meta.kind : theme)
    const toml = chosen ? undefined : (user ?? BUILTIN_TOML_THEMES[theme])
    applyThemeTokens(toml?.tokens)
    setActiveEditorTheme(toml ?? null)
  }, [chosen, theme, themeStamp])

  const toggle = useCallback((next?: ThemeName) => setTheme((t) => next ?? (t === 'dark' ? 'light' : 'dark')), [])

  return [theme, toggle]
}
