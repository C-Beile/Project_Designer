import { useSyncExternalStore } from 'react'
import { configGet, configSet } from '../settings/appConfig'
import { getUserThemes, subscribeThemes, USER_THEME_PATH } from '../theme/themeStore'
import { openThemeStudioWindow } from '../studio/registerThemeStudio'
import { notify } from '../core/notifications'
import { Button, Input } from '../core/ui/controls'

/** Options > Appearance > Theme: eigene Themes aus dem Nutzerordner wählen und das Theme Studio öffnen. */
export function UserThemeSection() {
  const themes = useSyncExternalStore(subscribeThemes, getUserThemes)
  const active = configGet<string>(...USER_THEME_PATH) ?? ''
  return (
    <fieldset className="forge-opt-group">
      <legend>Your themes</legend>
      <p className="forge-field-hint">Themes you made in the Theme Studio. They replace the theme chosen above while one of them is active.</p>
      {themes.length === 0 ? <p className="forge-field-hint">No theme of yours yet.</p> : null}
      <ul className="forge-user-themes">
        {themes.map((t) => (
          <li key={t.file}>
            <label>
              <Input type="radio" name="user-theme" checked={active === t.file} disabled={!t.parsed} onChange={() => configSet(USER_THEME_PATH, t.file)} /> {t.parsed?.meta.name ?? t.file}
              {t.error ? <small className="forge-field-error"> {t.error}</small> : null}
            </label>
          </li>
        ))}
      </ul>
      <div className="forge-opt-buttons">
        <Button variant="bare" isDisabled={!active} onClick={() => configSet(USER_THEME_PATH, undefined)}>
          Use the theme chosen above
        </Button>
        <Button variant="bare" onClick={() => !openThemeStudioWindow() && notify('Open Tools > Theme Studio.')}>
          Open Theme Studio
        </Button>
      </div>
    </fieldset>
  )
}
