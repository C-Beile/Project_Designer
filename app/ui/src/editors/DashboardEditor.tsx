import type { EditorProps } from './registry'
import { asArray, field, intField, textField, textValue } from '../wire/types'
import { EditableText } from './EditableText'

// Dashboard editor after the original Designer (reference shots 101302 / 102013): the dashlets as
// grey boxes on a three-column grid, each with Dashlet Name, Context Name, Entity Name, View Name
// and Config Name. The box sits at xPos/yPos and spans colspan/rowspan of the dashlet's
// uiConfiguration. Title, type, icon and roles are edited in the Properties panel, as in the original.
//
// Read from the shots: three equal columns, one row unit is about 36 px with a 10 px gap, and a
// dashlet without rowspan is drawn four units high (the 5 dashlets of the shot's Home all measure 4 or 8
// units). Not evidenced: where Context Name and Entity Name come from (empty for every dashlet of
// the shots; shown here only if the dashlet itself carries `contextName` / `entityName`) and the
// content of "Available Configs" in the Navigator.
//
// The grid position cannot be written yet: those values are typed attributes (`<xPos v="0" />`)
// and the write path only covers text content, so they are shown read-only. Name, view and
// config name are plain text and editable.

const COLUMNS = 3
const DEFAULT_ROWSPAN = 4

export function DashboardEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  async function commitScalar(path: string, next: string) {
    const updated = await api.setProperty(nodeId, path, textValue(next))
    onTreeChange(updated)
  }

  const dashlets = asArray(field(field(tree, 'defaultDashlets'), 'neonDashlet'))

  return (
    <div className="dashboard-editor" aria-label={`Dashboard ${textField(tree, 'name') ?? ''}`}>
      <div className="dashboard-canvas" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}>
        {dashlets.map((dashlet, index) => {
          const dashletName = textField(dashlet, 'name') ?? ''
          const viewName = textField(dashlet, 'viewName') ?? ''
          const configName = textField(dashlet, 'configName') ?? ''
          const contextName = textField(dashlet, 'contextName') ?? ''
          const entityName = textField(dashlet, 'entityName') ?? ''
          const ui = field(dashlet, 'uiConfiguration')
          const xPos = intField(ui, 'xPos') ?? 0
          const yPos = intField(ui, 'yPos') ?? 0
          const colspan = Math.max(1, Math.min(COLUMNS - xPos, intField(ui, 'colspan') ?? 1))
          const rowspan = Math.max(1, intField(ui, 'rowspan') ?? DEFAULT_ROWSPAN)
          const basePath = `defaultDashlets.neonDashlet[${index}]`
          return (
            <section
              key={`${dashletName}-${index}`}
              className="dashlet-box"
              data-x={xPos}
              data-y={yPos}
              data-colspan={colspan}
              data-rowspan={rowspan}
              title={`Position (${xPos}, ${yPos}), span (${colspan}, ${rowspan})`}
              style={{ gridColumn: `${xPos + 1} / span ${colspan}`, gridRow: `${yPos + 1} / span ${rowspan}` }}
            >
              <label>
                <span>Dashlet Name</span>
                <EditableText value={dashletName} ariaLabel={`Dashlet ${index} type`} onCommit={(next) => commitScalar(`${basePath}.name`, next)} />
              </label>
              <label>
                <span>Context Name</span>
                <span className="dashlet-value">{contextName}</span>
              </label>
              <label>
                <span>Entity Name</span>
                <span className="dashlet-value">{entityName}</span>
              </label>
              <label>
                <span>View Name</span>
                <EditableText value={viewName} ariaLabel={`Dashlet ${index} view`} onCommit={(next) => commitScalar(`${basePath}.viewName`, next)} />
              </label>
              <label>
                <span>Config Name</span>
                <EditableText value={configName} ariaLabel={`Dashlet ${index} config name`} onCommit={(next) => commitScalar(`${basePath}.configName`, next)} />
              </label>
            </section>
          )
        })}
      </div>
    </div>
  )
}
