import darkToml from '../../../config/themes/dark.theme.toml?raw'
import lightToml from '../../../config/themes/light.theme.toml?raw'
import lionToml from '../../../config/themes/lion.theme.toml?raw'
import { parseTheme, type ParsedTheme } from './themeToml'

/** Eingebaute Themes als Text aus `app/config/themes/`. */
export const BUILTIN_THEME_TEXTS: Record<string, string> = {
  lion: lionToml,
  dark: darkToml,
  light: lightToml,
}

export const BUILTIN_TOML_THEMES: Record<string, ParsedTheme> = Object.fromEntries(Object.entries(BUILTIN_THEME_TEXTS).map(([id, text]) => [id, parseTheme(text)]))
