import { groupFields, type ColorField } from './studioFields'
import { toColorInput } from './themeText'
import { Input } from '../core/ui/controls'

export interface ColorEditorProps {
  fields: ColorField[]
  readOnly: boolean
  onChange: (key: string, value: string) => void
}

/** Ein Farbfeld je Schlüssel, gruppiert. Die Vorschau daneben folgt jeder Änderung sofort. */
export function ColorEditor({ fields, readOnly, onChange }: ColorEditorProps) {
  return (
    <div className="ui-ColorEditor">
      {groupFields(fields).map(({ group, fields: inGroup }) => (
        <fieldset key={group} className="ui-ColorEditor-group">
          <legend>{group}</legend>
          {inGroup.map((f) => (
            <label key={f.key} className="ui-ColorEditor-row" title={f.description}>
              <Input type="color" aria-label={f.key} disabled={readOnly} value={toColorInput(f.effective)} onChange={(e) => onChange(f.key, e.target.value)} />
              <span className="ui-ColorEditor-name">
                <code>{f.key}</code>
                <small>{f.description}</small>
              </span>
              <small className="ui-ColorEditor-value">{f.own ?? `${f.effective} (inherited)`}</small>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  )
}
