import type { ComponentProps } from 'react'
import { SchemaForm } from '../core/ui/blocks/SchemaForm'
import { APPEARANCE_TABS_PAGE } from '../theme/appearanceSettings'
import { ThemePicker } from './ThemePicker'
import { UserThemeSection } from './UserThemeSection'

/** Options > Appearance > General: Theme (kompakt) und die Einstellung für Reiter mehrerer Projekte. */
export function AppearanceGeneralPage({ message, ...picker }: ComponentProps<typeof ThemePicker> & { message: { ok: boolean; text: string } | null }) {
  return (
    <>
      <h3>General</h3>
      <fieldset className="forge-opt-group">
        <legend>Theme</legend>
        <ThemePicker {...picker} />
        {message ? (
          <p className={message.ok ? 'forge-field-hint' : 'forge-field-error'} role={message.ok ? 'status' : 'alert'}>
            {message.text}
          </p>
        ) : null}
        <UserThemeSection />
      </fieldset>
      <SchemaForm page={APPEARANCE_TABS_PAGE} resettable={false} />
    </>
  )
}
