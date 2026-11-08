import { useState } from 'react'
import type { EditorProps } from './registry'
import { asArray, boolField, field, intField, textField, textValue } from '../wire/types'
import { EditableText } from './EditableText'

// Ziel 1 (aliasDefinition-Editor): name/targetAliasName/DB-type-hint plus the
// per-table column model (feature-matrix.md's AliasEditor MUST subset - "Editor für DB-Aliase").
//
// `aod-format.md` §3 / the alias schema document two shapes under the one `aliasDefinition`
// folder: a relational DB alias (`aliasDefinitionSub.aliasDefDb` present, e.g. `THHIT_Data_alias`)
// and other alias kinds (IndexSearch, mail server, ...) that carry only
// `name`/`title`/`datasourceType`, no `aliasDefinitionSub` at all (verified against Hermes'
// `IndexSearch`/`mailServerHermes` fixtures). This editor renders the DB-alias configuration when
// present and a plain identity view (with an explanatory note) otherwise - it never assumes
// `aliasDefinitionSub` exists.
//
// `datasourceType`/`columnType`/`size`/`primaryKey`/`notNull`/`isUnique`/`index` are all the XML's
// typed-scalar-attribute form (`<foo v="..." />`) - shown read-only for the same documented reason
// `DashboardEditor.tsx`'s grid position is read-only (`forge-core`'s write-back path only supports
// the `Text`-content scalar case today).
// `targetAliasName`/`dbName`/`idColumn`/`title` are plain `<foo>bar</foo>` text content and are
// fully editable.
// java.sql.Types constants as stored in `columnType`.
const SQL_TYPES: Record<number, string> = {
  [-9]: 'NVARCHAR',
  [-15]: 'NCHAR',
  [-16]: 'LONGNVARCHAR',
  [-7]: 'BIT',
  [-6]: 'TINYINT',
  [-5]: 'BIGINT',
  [-4]: 'LONGVARBINARY',
  [-3]: 'VARBINARY',
  [-2]: 'BINARY',
  [-1]: 'LONGVARCHAR',
  1: 'CHAR',
  2: 'NUMERIC',
  3: 'DECIMAL',
  4: 'INTEGER',
  5: 'SMALLINT',
  6: 'FLOAT',
  7: 'REAL',
  8: 'DOUBLE',
  12: 'VARCHAR',
  16: 'BOOLEAN',
  91: 'DATE',
  92: 'TIME',
  93: 'TIMESTAMP',
  2004: 'BLOB',
  2005: 'CLOB',
  2011: 'NCLOB',
}

export function sqlTypeName(code: number | undefined): string {
  if (code === undefined) return ''
  return SQL_TYPES[code] ?? String(code)
}

export function AliasDbEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())
  const toggleCard = (t: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  async function commitScalar(path: string, next: string) {
    const updated = await api.setProperty(nodeId, path, textValue(next))
    onTreeChange(updated)
  }

  const name = textField(tree, 'name') ?? ''
  const titleRaw = textField(tree, 'title')
  const datasourceType = intField(tree, 'datasourceType')

  const aliasDefDb = field(field(tree, 'aliasDefinitionSub'), 'aliasDefDb')

  if (!aliasDefDb) {
    return (
      <div className="alias-db-editor">
        <h2>{name}</h2>
        {titleRaw !== undefined && (
          <label>
            Title
            <EditableText value={titleRaw} ariaLabel="Alias title" onCommit={(next) => commitScalar('title', next)} />
          </label>
        )}
        <p className="alias-db-meta">Datasource type: {datasourceType ?? '–'}. This alias has no table configuration.</p>
      </div>
    )
  }

  const targetAliasName = textField(aliasDefDb, 'targetAliasName') ?? ''
  const entities = field(field(aliasDefDb, 'entityGroup'), 'entities')
  const tables = asArray(field(entities, 'entityDb'))
  const basePath = 'aliasDefinitionSub.aliasDefDb'

  return (
    <div className="alias-db-editor">
      <div className="alias-db-head">
        <h2>{name}</h2>
        <span className="alias-db-meta">Datasource type: {datasourceType ?? '–'}</span>
      </div>
      {titleRaw !== undefined && (
        <label className="alias-db-target">
          Title
          <EditableText value={titleRaw} ariaLabel="Alias title" onCommit={(next) => commitScalar('title', next)} />
        </label>
      )}
      <label className="alias-db-target">
        Target alias name
        <EditableText
          value={targetAliasName}
          ariaLabel="Alias target alias name"
          onCommit={(next) => commitScalar(`${basePath}.targetAliasName`, next)}
        />
      </label>

      <div className="alias-db-toolbar">
        <input type="search" aria-label="Filter tables and columns" placeholder="Filter tables and columns" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="alias-db-meta">{tables.length} tables</span>
        <button type="button" onClick={() => setCollapsed(new Set(tables.map((_, i) => i)))}>
          Collapse all
        </button>
        <button type="button" onClick={() => setCollapsed(new Set())}>
          Expand all
        </button>
      </div>

      {tables.map((table, t) => {
        const tableName = textField(table, 'name') ?? ''
        const idColumn = textField(table, 'idColumn') ?? ''
        const tableBasePath = `${basePath}.entityGroup.entities.entityDb[${t}]`
        const allColumns = asArray(field(field(table, 'entityFields'), 'entityFieldDb'))
        const needle = filter.trim().toLowerCase()
        const tableHit = !needle || tableName.toLowerCase().includes(needle)
        const columnShown = (column: (typeof allColumns)[number]) => tableHit || (textField(column, 'name') ?? '').toLowerCase().includes(needle) || (textField(column, 'dbName') ?? '').toLowerCase().includes(needle)
        if (!tableHit && !allColumns.some(columnShown)) return null
        const columns = allColumns.filter(columnShown)
        const isCollapsed = collapsed.has(t) && !needle

        return (
          <section key={tableName || t} className="alias-card" aria-label={`Table ${tableName || t}`}>
            <header className="alias-card-head">
              <button type="button" className="alias-card-toggle" aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${tableName}`} onClick={() => toggleCard(t)}>
                {isCollapsed ? '▸' : '▾'}
              </button>
              <h3>{tableName}</h3>
              <label>
                Id column
                <EditableText
                  value={idColumn}
                  ariaLabel={`Table ${t} id column`}
                  onCommit={(next) => commitScalar(`${tableBasePath}.idColumn`, next)}
                />
              </label>
              <span className="alias-card-count">{columns.length === allColumns.length ? `${allColumns.length} columns` : `${columns.length} of ${allColumns.length} columns`}</span>
            </header>

            {isCollapsed ? null : (
            <table className="alias-columns" aria-label={`Table ${tableName || t} columns`}>
              <colgroup>
                <col className="alias-col-pk" />
                <col className="alias-col-name" />
                <col className="alias-col-override" />
                <col className="alias-col-type" />
                <col className="alias-col-size" />
                <col className="alias-col-null" />
              </colgroup>
              <thead>
                <tr>
                  <th aria-label="Primary key" />
                  <th>Column</th>
                  <th>DB name override</th>
                  <th>SQL type</th>
                  <th className="alias-num">Size</th>
                  <th>Not null</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((column, c) => {
                  const columnName = textField(column, 'name') ?? ''
                  const dbName = textField(column, 'dbName') ?? ''
                  const columnType = intField(column, 'columnType')
                  const size = intField(column, 'size')
                  const primaryKey = boolField(column, 'primaryKey')
                  const notNull = boolField(column, 'notNull')
                  const columnBasePath = `${tableBasePath}.entityFields.entityFieldDb[${c}]`

                  return (
                    <tr key={columnName || c}>
                      <td className="alias-pk">{primaryKey ? <span role="img" aria-label="primary key" title="Primary key">{'⚿'}</span> : null}</td>
                      <td>{columnName}</td>
                      <td>
                        <EditableText
                          value={dbName}
                          ariaLabel={`Table ${t} column ${c} db name`}
                          onCommit={(next) => commitScalar(`${columnBasePath}.dbName`, next)}
                        />
                      </td>
                      <td className="alias-type-name" title={columnType === undefined ? undefined : `java.sql.Types ${columnType}`}>{sqlTypeName(columnType)}</td>
                      <td className="alias-num">{size ?? ''}</td>
                      <td>{notNull ? 'yes' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            )}
          </section>
        )
      })}
    </div>
  )
}
