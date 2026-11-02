import * as monaco from 'monaco-editor'
import { newUuid } from '../shell/uuid'

// "Generate" menu of the original Designer (Alt+Ins > UUID): inserts a new UUID at the caret or
// over the selection. Read-only editors are left alone.
export function addInsertUuidAction(editor: monaco.editor.IStandaloneCodeEditor): void {
  editor.addAction({
    id: 'forge.insertUuid',
    label: 'Generate: UUID',
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Insert],
    contextMenuGroupId: 'modification',
    run: (ed) => {
      if (ed.getOption(monaco.editor.EditorOption.readOnly)) return
      const range = ed.getSelection()
      if (!range) return
      ed.executeEdits('forge-uuid', [{ range, text: newUuid(), forceMoveMarkers: true }])
    },
  })
}
