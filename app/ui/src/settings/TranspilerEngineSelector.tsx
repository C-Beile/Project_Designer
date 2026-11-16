import { Dropdown } from '../core/ui/controls'
import { ENGINE_LABELS, EXPERIMENTAL_WARNING, type TranspilerEngineId } from './transpilerEngine'

export type { TranspilerEngineId } from './transpilerEngine'

// Compact engine choice next to the toolbar's Transpile button. The chosen engine lives in the
// shell's session state (shared with Tools > Transpiler), never in storage - see transpilerEngine.ts.
export function TranspilerEngineSelector({
  engine,
  onChange,
  disabled = false,
}: {
  engine: TranspilerEngineId
  onChange: (engine: TranspilerEngineId) => void
  disabled?: boolean
}) {
  return (
    <Dropdown
      className="forge-engine-select"
      aria-label="Transpiler engine"
      title={ENGINE_LABELS[engine]}
      value={engine}
      isDisabled={disabled}
      data-engine={engine}
      onChange={(v) => onChange(v as TranspilerEngineId)}
      options={[
        { id: 'official', label: 'ADITO Transpiler' },
        { id: 'experimental', label: 'Dito_Transpiler' },
        { id: 'dito-v2', label: 'Dito Transpiler V2' },
      ]}
    />
  )
}

// Shown below the toolbar for as long as the experimental engine is selected.
export function ExperimentalEngineWarning({ engine }: { engine: TranspilerEngineId }) {
  void engine
  void EXPERIMENTAL_WARNING
  return null
}
