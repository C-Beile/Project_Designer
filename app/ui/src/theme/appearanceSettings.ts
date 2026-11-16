import { registerSetting, useSettingValue, type SettingSpec } from '../core/contrib/settings'
import { FONT_IDS, FONT_LABELS } from '../config/styleConfig'
import { DEFAULT_FONT_SIZE, FONT_SIZE_RANGE } from './appearance'

export const APPEARANCE_TEXT_PAGE = 'appearance.text'
export const APPEARANCE_TABS_PAGE = 'appearance.tabs'

/** Wie Reiter mehrerer Projekte auseinandergehalten werden: Farbstreifen oben oder nach Projekt gruppiert. */
export const TAB_GROUPING: SettingSpec = {
  id: 'appearance.tabGrouping',
  page: APPEARANCE_TABS_PAGE,
  order: 1,
  kind: 'enum',
  label: 'Projects in editor tabs',
  default: 'stripe',
  options: [
    { id: 'stripe', label: 'Color stripe on each tab' },
    { id: 'grouped', label: 'Tabs grouped by project' },
  ],
  path: ['appearance', 'tabGrouping'],
}

/** Was passiert, wenn mehr Reiter offen sind, als in die Leiste passen. */
export const TAB_OVERFLOW: SettingSpec = {
  id: 'appearance.tabOverflow',
  page: APPEARANCE_TABS_PAGE,
  order: 2,
  kind: 'enum',
  label: 'Too many tabs',
  default: 'wrap',
  options: [
    { id: 'dropdown', label: 'Hidden tabs in a dropdown on the right' },
    { id: 'scroll', label: 'Scroll the tab bar (mouse wheel or scrollbar)' },
    { id: 'wrap', label: 'Stack tabs in rows, all visible' },
  ],
  path: ['appearance', 'tabOverflow'],
}

export type TabOverflow = 'dropdown' | 'scroll' | 'wrap'
export const useTabOverflow = (): TabOverflow => {
  const v = useSettingValue(TAB_OVERFLOW)
  return v === 'scroll' || v === 'dropdown' ? v : 'wrap'
}

export const useTabGrouping = (): 'stripe' | 'grouped' => (useSettingValue(TAB_GROUPING) === 'grouped' ? 'grouped' : 'stripe')

/** Die Einstellungen von Options > Appearance > Text & size. `appearance.ts` wendet sie an, sobald sich `[appearance]` ändert. */
export function registerAppearanceSettings(): () => void {
  const offs = [
    registerSetting(TAB_GROUPING),
    registerSetting(TAB_OVERFLOW),
    registerSetting({ id: 'appearance.fontSize', page: APPEARANCE_TEXT_PAGE, order: 1, kind: 'int', label: 'Text size', unit: 'px', min: FONT_SIZE_RANGE[0], max: FONT_SIZE_RANGE[1], default: DEFAULT_FONT_SIZE, path: ['appearance', 'fontSize'] }),
    registerSetting({ id: 'appearance.fontFamily', page: APPEARANCE_TEXT_PAGE, order: 2, kind: 'text', label: 'Font', placeholder: 'Default (Segoe UI)', hint: 'Any font installed on this computer, e.g. Inter or Verdana.', default: '', path: ['appearance', 'fontFamily'] }),
    registerSetting({
      id: 'appearance.identFont',
      page: APPEARANCE_TEXT_PAGE,
      order: 3,
      kind: 'enum',
      label: 'Identifier font',
      hint: 'Used for field names, values and other technical names. Code editors have their own font under Code formatting.',
      default: '',
      options: [{ id: '', label: 'Default' }, ...FONT_IDS.map((id) => ({ id, label: FONT_LABELS[id] }))],
      path: ['appearance', 'identFont'],
    }),
    registerSetting({
      id: 'appearance.density',
      page: APPEARANCE_TEXT_PAGE,
      order: 4,
      kind: 'enum',
      label: 'Density',
      default: 'normal',
      options: [
        { id: 'normal', label: 'Normal' },
        { id: 'compact', label: 'Compact' },
      ],
      path: ['appearance', 'density'],
    }),
  ]
  return () => offs.forEach((off) => off())
}
