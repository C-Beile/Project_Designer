import { useSyncExternalStore } from 'react'
import { configGet, configSet } from '../settings/appConfig'
import { getUserThemes, subscribeThemes, USER_THEME_PATH } from '../theme/themeStore'
import { openThemeStudioWindow } from '../studio/registerThemeStudio'
import { notify } from '../core/notifications'
import { Button, Input } from '../core/ui/controls'

/** Options > Appearance > General: eigene Themes aus dem Nutzerordner wählen und das Theme Studio öffnen. */
export function UserThemeSection() {
  const themes = useSyncExternalStore(subscribeThemes, getUserThemes)
  const active = configGet<string>(...USER_THEME_PATH) ?? ''
  return (
    <div className="forge-user-themes-row">
      {themes.map((t) => (
        <label key={t.file} title={t.error}>
          <Input type="radio" name="user-theme" checked={active === t.file} disabled={!t.parsed} onChange={() => configSet(USER_THEME_PATH, t.file)} /> {t.parsed?.meta.name ?? t.file}
        </label>
      ))}
      {active ? (
        <Button variant="bare" onClick={() => configSet(USER_THEME_PATH, undefined)}>
          Use the theme above
        </Button>
      ) : null}
      <Button variant="bare" onClick={() => !openThemeStudioWindow() && notify('Open Tools > Theme Studio.')}>
        Open Theme Studio
      </Button>
    </div>
  )
}
