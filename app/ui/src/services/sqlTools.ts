import { configGet, configSet } from '../settings/appConfig'
// Pure helpers of the Execute SQL window (manual chapter 8): statement splitting for "run sql",
// the statement under the cursor for "run statement", CSV export of a result and the statements
// behind the editable result grid. Nothing here talks to the database.

export interface SqlStatement {
  text: string
  start: number
  end: number
}

// Splits on semicolons that are neither inside quotes/identifiers nor inside comments.
export function splitStatements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = []
  let start = 0
  let i = 0
  const push = (end: number) => {
    const raw = sql.slice(start, end)
    const text = raw.trim()
    if (text && !isOnlyComments(text)) {
      const lead = raw.length - raw.trimStart().length
      out.push({ text, start: start + lead, end: start + lead + text.length })
    }
  }
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < sql.length) {
        if (sql[i] === '\\' && c !== '`') i += 2
        else if (sql[i] === c && sql[i + 1] === c) i += 2
        else if (sql[i] === c) break
        else i++
      }
      i++
    } else if ((c === '-' && next === '-') || c === '#') {
      while (i < sql.length && sql[i] !== '\n') i++
    } else if (c === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2)
      i = close < 0 ? sql.length : close + 2
    } else if (c === ';') {
      push(i)
      start = i + 1
      i++
    } else {
      i++
    }
  }
  push(sql.length)
  return out
}

function isOnlyComments(text: string): boolean {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*(--|#)[^\n]*/g, '$1')
  return stripped.trim() === ''
}

// Statement the caret is in (or directly after); falls back to the nearest one.
export function statementAt(sql: string, offset: number): SqlStatement | null {
  const all = splitStatements(sql)
  if (all.length === 0) return null
  const hit = all.find((s) => offset >= s.start && offset <= s.end + 1)
  if (hit) return hit
  let best = all[0]
  for (const s of all) if (Math.abs(s.start - offset) < Math.abs(best.start - offset)) best = s
  return best
}

function csvCell(value: string | null, sep: string): string {
  if (value === null) return ''
  return /["\r\n]/.test(value) || value.includes(sep) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(columns: string[], rows: (string | null)[][], sep = ';'): string {
  const lines = [columns.map((c) => csvCell(c, sep)).join(sep)]
  for (const r of rows) lines.push(r.map((c) => csvCell(c, sep)).join(sep))
  return lines.join('\r\n') + '\r\n'
}

export function matchesFilter(row: (string | null)[], needle: string): boolean {
  const n = needle.trim().toLowerCase()
  if (!n) return true
  return row.some((c) => c !== null && c.toLowerCase().includes(n))
}

// Table of a plain `select ... from <table>` (one table, no join); null if the result is not
// directly editable.
export function editableTable(sql: string): string | null {
  const text = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*(--|#)[^\n]*/g, '$1').trim()
  if (!/^select\b/i.test(text)) return null
  if (/\b(join|union|group\s+by|distinct)\b/i.test(text)) return null
  const m = /\bfrom\s+(`?[A-Za-z_][\w$]*`?(?:\.`?[A-Za-z_][\w$]*`?)?)\s*(?:where\b|order\b|limit\b|$)/i.exec(text)
  return m ? m[1] : null
}

export function sqlLiteral(value: string | null): string {
  if (value === null) return 'NULL'
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

const ident = (name: string) => `\`${name.replace(/`/g, '``')}\``

function whereOf(columns: string[], original: (string | null)[]): string {
  return columns.map((c, i) => (original[i] === null ? `${ident(c)} IS NULL` : `${ident(c)} = ${sqlLiteral(original[i])}`)).join(' AND ')
}

// Without a known primary key the whole original row identifies the row; LIMIT 1 makes sure at
// most one row is touched even if the table holds exact duplicates.
export function buildUpdate(table: string, columns: string[], original: (string | null)[], edited: (string | null)[]): string | null {
  const set = columns.map((c, i) => (original[i] === edited[i] ? null : `${ident(c)} = ${sqlLiteral(edited[i])}`)).filter(Boolean)
  if (set.length === 0) return null
  return `UPDATE ${table} SET ${set.join(', ')} WHERE ${whereOf(columns, original)} LIMIT 1`
}

export function buildDelete(table: string, columns: string[], original: (string | null)[]): string {
  return `DELETE FROM ${table} WHERE ${whereOf(columns, original)} LIMIT 1`
}

export function buildInsert(table: string, columns: string[], values: (string | null)[]): string {
  return `INSERT INTO ${table} (${columns.map(ident).join(', ')}) VALUES (${values.map(sqlLiteral).join(', ')})`
}

const HISTORY_PATH = ['sql', 'history'] as const
const HISTORY_MAX = 100

export function loadSqlHistory(): string[] {
  const parsed = configGet<unknown>(...HISTORY_PATH)
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, HISTORY_MAX) : []
}

// Newest first, duplicates collapse to their latest use.
export function pushSqlHistory(sql: string): string[] {
  const list = [sql, ...loadSqlHistory().filter((s) => s !== sql)].slice(0, HISTORY_MAX)
  configSet(HISTORY_PATH, list)
  return list
}

export function clearSqlHistory(): void {
  configSet(HISTORY_PATH, undefined)
}
