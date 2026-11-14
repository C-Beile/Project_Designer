import { registerSetting } from '../core/contrib/settings'
import { DEFAULT_FONT_SIZE, FONT_SIZE_RANGE } from './appearance'

export const APPEARANCE_TEXT_PAGE = 'appearance.text'

/** Die Einstellungen von Options > Appearance > Text & size. `appearance.ts` wendet sie an, sobald sich `[appearance]` ändert. */
export function registerAppearanceSettings(): () => void {
  const offs = [
    registerSetting({ id: 'appearance.fontSize', page: APPEARANCE_TEXT_PAGE, order: 1, kind: 'int', label: 'Text size', unit: 'px', min: FONT_SIZE_RANGE[0], max: FONT_SIZE_RANGE[1], default: DEFAULT_FONT_SIZE, path: ['appearance', 'fontSize'] }),
    registerSetting({ id: 'appearance.fontFamily', page: APPEARANCE_TEXT_PAGE, order: 2, kind: 'text', label: 'Font', placeholder: 'Default (Segoe UI)', hint: 'Any font installed on this computer, e.g. Inter or Verdana.', default: '', path: ['appearance', 'fontFamily'] }),
    registerSetting({
      id: 'appearance.density',
      page: APPEARANCE_TEXT_PAGE,
      order: 3,
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
