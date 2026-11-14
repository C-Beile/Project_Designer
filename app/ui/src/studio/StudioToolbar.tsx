import { Button, Select } from '../core/ui/controls'
import type { createThemeActions, StudioSource } from './useThemeActions'

export interface StudioToolbarProps {
  sources: StudioSource[]
  source: StudioSource
  dirty: boolean
  hasError: boolean
  actions: ReturnType<typeof createThemeActions>
  onSelect: (id: string) => void
  onClose: () => void
}

/** Kopf mit Theme-Auswahl und Knopfleiste mit den Aktionen. */
export function StudioToolbar({ sources, source, dirty, hasError, actions, onSelect, onClose }: StudioToolbarProps) {
  return (
    <>
      <header className="ui-Studio-header">
        <h3>Theme Studio</h3>
        <Select label="Theme" options={sources.map((s) => ({ id: s.id, label: s.label }))} selectedKey={source.id} onSelectionChange={(key) => onSelect(String(key))} />
        <Button onPress={() => void actions.reload()}>Reload</Button>
        <Button onPress={() => void actions.openFolder()}>Open folder</Button>
        <Button variant="quiet" onPress={onClose}>
          Close
        </Button>
      </header>
      <div className="ui-Studio-actions">
        <Button variant="primary" isDisabled={(source.kind === 'user' && !dirty) || (source.kind !== 'user' && hasError)} onPress={() => void actions.save()}>
          {source.kind === 'user' ? 'Save' : 'Save as copy…'}
        </Button>
        <Button onPress={() => void actions.saveAsCopy()}>New theme from this…</Button>
        <Button isDisabled={source.kind !== 'user'} onPress={() => void actions.remove()}>
          Delete
        </Button>
        <Button isDisabled={dirty || hasError} onPress={actions.useAsMine}>
          Use as my theme
        </Button>
        {dirty ? <span className="ui-Studio-dirty">Unsaved changes</span> : null}
      </div>
    </>
  )
}
