import { useSettings, useSettingValue, writeSetting, type SettingSpec } from '../../contrib/settings'
import { Button, Checkbox, Select, Slider, TextField } from '../controls'

function Field({ spec }: { spec: SettingSpec }) {
  const value = useSettingValue(spec)
  const isDefault = value === spec.default
  return (
    <div className="ui-SchemaForm-field">
      {spec.kind === 'bool' ? (
        <Checkbox isSelected={value as boolean} onChange={(v) => writeSetting(spec, v)}>
          {spec.label}
        </Checkbox>
      ) : null}
      {spec.kind === 'text' ? <TextField label={spec.label} placeholder={spec.placeholder} value={value as string} onChange={(v) => writeSetting(spec, v)} /> : null}
      {spec.kind === 'int' ? <Slider label={spec.label} unit={spec.unit} minValue={spec.min} maxValue={spec.max} value={value as number} onChange={(v) => writeSetting(spec, v)} /> : null}
      {spec.kind === 'enum' ? <Select label={spec.label} options={spec.options} selectedKey={value as string} onSelectionChange={(key) => writeSetting(spec, String(key))} /> : null}
      {spec.hint ? <small className="ui-SchemaForm-hint">{spec.hint}</small> : null}
      <Button variant="quiet" isDisabled={isDefault} aria-label={`Reset ${spec.label}`} onPress={() => writeSetting(spec, spec.default)}>
        Reset
      </Button>
    </div>
  )
}

/** Formular aus den Einstellungen einer Seite (`registerSetting`). Jede Änderung wirkt sofort und steht in `designer.conf`. */
export function SchemaForm({ page }: { page: string }) {
  const specs = useSettings(page)
  return (
    <div className="ui-SchemaForm">
      {specs.map((spec) => (
        <Field key={spec.id} spec={spec} />
      ))}
    </div>
  )
}
