import type { ForgeApi } from '../api/ForgeApi'
import { confirmDialog, promptDialog } from '../core/dialogService'
import { errorText } from '../core/errorText'
import { notify } from '../core/notifications'
import { configGet, configSet } from '../settings/appConfig'
import { BUILTIN_THEME_TEXTS } from '../theme/builtinThemes'
import { getUserThemes, loadUserThemes, USER_THEME_PATH } from '../theme/themeStore'
import type { ParsedTheme } from '../theme/themeToml'
import { retitleTheme, themeFileName } from './themeText'

export const TEMPLATE_ID = 'lion'
export const USER_PREFIX = 'user:'

export interface StudioSource {
  id: string
  label: string
  /** `builtin`: eingebaut, nur als Kopie speicherbar. `imported`: importiertes VS-Code-Theme, ebenfalls nur als Kopie. `user`: Datei des Nutzers. */
  kind: 'builtin' | 'imported' | 'user'
  text: string
}

export type StudioApi = Pick<ForgeApi, 'userThemes' | 'saveUserTheme' | 'deleteUserTheme' | 'openUserThemesFolder'>

export interface StudioState {
  api: StudioApi
  source: StudioSource
  text: string
  parsed: ParsedTheme | null
  dirty: boolean
  /** Setzt Auswahl, Text und gespeicherten Stand zusammen (Wechsel, Kopie, Löschen). */
  load: (id: string, text: string) => void
  markSaved: (text: string) => void
  refresh: () => void
}

async function attempt(work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (e) {
    notify(errorText(e), { kind: 'error' })
  }
}

const fileOf = (source: StudioSource) => source.id.slice(USER_PREFIX.length)

function nameCheck(value: string): string | null {
  const file = themeFileName(value)
  if (file === null) return 'Use letters or digits.'
  return getUserThemes().some((u) => u.file === file) ? 'A theme with this name exists.' : null
}

/** Die Aktionen der Knopfleiste des Studios. Jede meldet Fehler als Hinweis. */
export function createThemeActions(s: StudioState) {
  const saveAsCopy = async () => {
    const initial = `${s.source.label.replace(/ \(yours\)$/, '')} copy`
    const name = await promptDialog('Name of the new theme', { initial, okLabel: 'Save', title: 'Save theme as', validate: nameCheck })
    const file = name ? themeFileName(name) : null
    if (!name || !file) return
    const copy = retitleTheme(s.text, name, file, s.parsed?.meta.kind ?? 'dark')
    await attempt(async () => {
      await s.api.saveUserTheme(file, copy)
      await loadUserThemes(s.api)
      s.load(USER_PREFIX + file, copy)
      notify(`Saved ${file}.`)
    })
  }

  const save = async () => {
    if (s.source.kind !== 'user') return saveAsCopy()
    await attempt(async () => {
      await s.api.saveUserTheme(fileOf(s.source), s.text)
      await loadUserThemes(s.api)
      s.markSaved(s.text)
      notify('Theme saved.')
    })
  }

  const remove = async () => {
    if (s.source.kind !== 'user' || !(await confirmDialog(`Delete the theme "${s.source.label}"? This cannot be undone.`, { okLabel: 'Delete', title: 'Delete theme' }))) return
    await attempt(async () => {
      await s.api.deleteUserTheme(fileOf(s.source))
      if (configGet<string>(...USER_THEME_PATH) === fileOf(s.source)) configSet(USER_THEME_PATH, undefined)
      await loadUserThemes(s.api)
      s.load(TEMPLATE_ID, BUILTIN_THEME_TEXTS[TEMPLATE_ID])
    })
  }

  const reload = async () => {
    await attempt(async () => {
      const users = await loadUserThemes(s.api)
      const fresh = s.source.kind === 'user' ? users.find((u) => USER_PREFIX + u.file === s.source.id) : undefined
      if (!s.dirty && fresh) s.load(s.source.id, fresh.text)
      s.refresh()
      notify(`Themes reloaded: ${users.length} of yours.`)
    })
  }

  const useAsMine = () => {
    if (s.source.kind === 'user') configSet(USER_THEME_PATH, fileOf(s.source))
    else {
      configSet(USER_THEME_PATH, undefined)
      configSet(['appearance', 'theme'], s.source.id === 'lion' ? undefined : s.source.id)
    }
    notify(`${s.source.label} is now your theme.`)
  }

  const openFolder = () => attempt(async () => void (await s.api.openUserThemesFolder()))

  return { saveAsCopy, save, remove, reload, useAsMine, openFolder }
}

export function currentSourceId(): string {
  const user = configGet<string>(...USER_THEME_PATH)
  if (user) return USER_PREFIX + user
  const theme = configGet<string>('appearance', 'theme')
  return theme === 'dark' || theme === 'light' ? theme : TEMPLATE_ID
}
