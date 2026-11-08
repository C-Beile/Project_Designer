import type { ForgeApi } from '../api/ForgeApi'
import { findObject } from '../core/treeIndex'
import { AliasConfigPanel } from '../properties/AliasConfigPanel'
import { codeTabNode } from '../properties/codeSave'
import { FilePropertiesPanel } from '../properties/FilePropertiesPanel'
import { objectRoot } from '../properties/objectRoot'
import { resolvePathVariables } from '../properties/pathVariables'
import { ProjectPropertiesPanel, PropertySheetPanel } from '../properties/PropertySheetPanel'
import { UserPropertiesPanel } from '../services/UserPropertiesPanel'
import type { useUserSelection } from '../services/userSelection'
import { projectOfPath } from '../services/tunnelState'
import { tunnelTabNode } from '../tabs/tabModel'
import type { AliasConfigDto, TreeNode, UndoRedoOutcome } from '../wire/types'
import { baseName, type nodeKind } from './shellHelpers'

export interface PropertiesBodyProps {
  api: ForgeApi
  userSel: ReturnType<typeof useUserSelection>
  aliasSel: { config: AliasConfigDto; system: string } | null
  inspected: TreeNode | null
  inspectedKind: ReturnType<typeof nodeKind> | null
  inspectedObject: TreeNode | null
  elementPath: string | null
  root: string
  projects: string[]
  tree: TreeNode[]
  objectsByType: ReadonlyMap<string, ReadonlySet<string>>
  sheetVersion: number
  handleOpen: (node: TreeNode) => Promise<void>
  applyOutcome: (nodeId: string, outcome: UndoRedoOutcome) => void
  setStatus: (text: string) => void
  onModificationChanged: () => void
}

// Inhalt des Properties-Panels: je nach Auswahl Benutzer, Alias, Projekt, Datei oder Objekt.
export function PropertiesBody({ api, userSel, aliasSel, inspected, inspectedKind, inspectedObject, elementPath, root, projects, tree, objectsByType, sheetVersion, handleOpen, applyOutcome, setStatus, onModificationChanged }: PropertiesBodyProps) {
  if (userSel) return <UserPropertiesPanel api={api} selection={userSel} />
  if (aliasSel) return <AliasConfigPanel config={aliasSel.config} system={aliasSel.system} />
  if (!inspected) return <div className="forge-panel-empty">&lt;No Properties&gt;</div>
  if (inspectedKind === 'project' || inspectedKind === 'module') return <ProjectPropertiesPanel api={api} name={inspected.type_label ?? inspected.label} path={inspected.path ?? inspected.id} />
  if (inspected && inspectedKind === 'file' && !inspected.code && !inspected.id.startsWith('tunnel:')) return <FilePropertiesPanel api={api} path={inspected.id} />
  if (!inspectedObject) return <div className="forge-panel-empty">&lt;No Properties&gt;</div>
  return (
    <PropertySheetPanel
      api={api}
      target={{ nodeId: inspectedObject.id, path: elementPath ?? '$' }}
      linkedRoot={objectRoot(inspectedObject.id)}
      projectRoot={root}
      version={sheetVersion}
      referenceOptions={(type) => [...(objectsByType.get(type) ?? [])].sort((a, b) => a.localeCompare(b))}
      onGoTo={(type, name) => {
        const target = findObject(tree, type, name)
        if (target) void handleOpen(target)
        else setStatus(`${name} not found in the open projects.`)
      }}
      onEdited={(nodeId, outcome) => applyOutcome(nodeId, outcome)}
      onStatus={setStatus}
      onOpenCode={(code, readOnly) => void handleOpen(codeTabNode(code, readOnly))}
      onOpenFile={(path) => void handleOpen({ id: path, label: baseName(path), object_type: null, kind: 'file', is_leaf: true, children: [] })}
      onModificationChanged={onModificationChanged}
      onEditConfig={
        inspectedObject.object_type === 'system'
          ? (name, reference) => {
              if (name === 'tunnelConfigPath') {
                if (reference) void handleOpen(tunnelTabNode(inspectedObject.id, inspectedObject.label, reference))
              } else if (reference) {
                const file = resolvePathVariables('serverConfigPath', reference, { projectHome: projectOfPath(projects, inspectedObject.id) ?? root }).resolved
                void handleOpen({ id: file, label: baseName(file), object_type: null, kind: 'file', is_leaf: true, children: [] })
              } else {
                setStatus('serverConfigPath of this system is not set yet. Choose the file with the ... button.')
              }
            }
          : undefined
      }
    />
  )
}
