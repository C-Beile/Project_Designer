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
    <select
      className="forge-engine-select"
      aria-label="Transpiler engine"
      title={ENGINE_LABELS[engine]}
      value={engine}
      disabled={disabled}
      data-engine={engine}
      onChange={(e) => onChange(e.target.value as TranspilerEngineId)}
    >
      <option value="experimental">Dito_Transpiler</option>
      <option value="official">Official</option>
    </select>
  )
}

// Shown below the toolbar for as long as the experimental engine is selected.
export function ExperimentalEngineWarning({ engine }: { engine: TranspilerEngineId }) {
  void engine
  void EXPERIMENTAL_WARNING
  return null
}
