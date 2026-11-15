import { useSettings, useSettingValue, writeSetting, type SettingSpec } from '../../contrib/settings'
import { Button, Checkbox, Select, Slider, TextField } from '../controls'

function Field({ spec, resettable }: { spec: SettingSpec; resettable: boolean }) {
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
      {resettable ? (
        <Button variant="quiet" isDisabled={isDefault} aria-label={`Reset ${spec.label}`} onPress={() => writeSetting(spec, spec.default)}>
          Reset
        </Button>
      ) : null}
    </div>
  )
}

/** Formular aus den Einstellungen einer Seite (`registerSetting`). Jede Änderung wirkt sofort und steht in `designer.conf`. `resettable={false}` blendet die Reset-Knöpfe aus. */
export function SchemaForm({ page, resettable = true }: { page: string; resettable?: boolean }) {
  const specs = useSettings(page)
  return (
    <div className="ui-SchemaForm">
      {specs.map((spec) => (
        <Field key={spec.id} spec={spec} resettable={resettable} />
      ))}
    </div>
  )
}
