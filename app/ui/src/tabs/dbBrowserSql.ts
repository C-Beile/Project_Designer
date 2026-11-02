// Statements and texts of the database browser. Everything here only reads the schema
// (INFORMATION_SCHEMA); the changelog is text for the user to copy, it is never run.

export interface ColumnInfo {
  name: string
  type: string
  dbType: string
  length: string
  scale: string
  nullable: boolean
  defaultValue: string | null
  key: string
}

const IDENT = /^[A-Za-z0-9_$]+$/

export function isSafeIdentifier(name: string): boolean {
  return IDENT.test(name)
}

function literal(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

export const TABLES_SQL = "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME"
export const CATALOG_SQL = 'SELECT DATABASE()'

export function columnsSql(table: string): string {
  return `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${literal(table)} ORDER BY ORDINAL_POSITION`
}

/** Rows of `columnsSql` as shown in the column grid. */
export function columnInfos(rows: (string | null)[][]): ColumnInfo[] {
  return rows.map((r) => ({
    name: r[0] ?? '',
    type: (r[1] ?? '').toUpperCase(),
    dbType: r[2] ?? '',
    length: r[3] ?? r[4] ?? '',
    scale: r[5] ?? '',
    nullable: (r[6] ?? '').toUpperCase() === 'YES',
    defaultValue: r[7],
    key: r[8] ?? '',
  }))
}

export function viewDataSql(table: string, limit = 100): string | null {
  return isSafeIdentifier(table) ? `SELECT * FROM \`${table}\` LIMIT ${limit}` : null
}

function xml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** createTable changeset for the table as it is now: preConditions first, then comment, then the change. */
export function changelogFor(table: string, columns: ColumnInfo[], author: string, date: string): string {
  const cols = columns
    .map((c) => {
      const constraints: string[] = []
      if (c.key === 'PRI') constraints.push('primaryKey="true"')
      if (!c.nullable) constraints.push('nullable="false"')
      const def = c.defaultValue !== null && c.defaultValue !== 'NULL' ? ` defaultValue="${xml(c.defaultValue)}"` : ''
      const inner = constraints.length > 0 ? `\n                <constraints ${constraints.join(' ')}/>\n            ` : ''
      const open = `            <column name="${xml(c.name)}" type="${xml(c.dbType || c.type)}"${def}`
      return inner ? `${open}>${inner}</column>` : `${open}/>`
    })
    .join('\n')
  return `    <changeSet id="create_${xml(table)}_${date}" author="${xml(author)}">
        <preConditions onFail="MARK_RAN">
            <not>
                <tableExists tableName="${xml(table)}"/>
            </not>
        </preConditions>
        <comment>Creates ${xml(table)} as it exists in the database now</comment>
        <createTable tableName="${xml(table)}">
${cols}
        </createTable>
    </changeSet>`
}

export interface IndexInfo {
  name: string
  columns: string
  unique: boolean
}

export interface ForeignKeyInfo {
  name: string
  column: string
  refTable: string
  refColumn: string
}

export function indexesSql(table: string): string {
  return `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX), NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${literal(table)} GROUP BY INDEX_NAME, NON_UNIQUE ORDER BY INDEX_NAME`
}

export function foreignKeysSql(table: string): string {
  return `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${literal(table)} AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`
}

export const PROCEDURES_SQL = 'SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_NAME'

export const indexInfos = (rows: (string | null)[][]): IndexInfo[] => rows.map((r) => ({ name: r[0] ?? '', columns: r[1] ?? '', unique: (r[2] ?? '1') === '0' }))

export const foreignKeyInfos = (rows: (string | null)[][]): ForeignKeyInfo[] => rows.map((r) => ({ name: r[0] ?? '', column: r[1] ?? '', refTable: r[2] ?? '', refColumn: r[3] ?? '' }))
