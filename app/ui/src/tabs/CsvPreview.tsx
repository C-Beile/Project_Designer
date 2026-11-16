import { useMemo } from 'react'
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '../core/ui/controls'

// Tabelle zu einer CSV-Datei neben dem Quelltext. Das Trennzeichen (Komma, Semikolon, Tab) wird erkannt.
// Es werden höchstens MAX_ROWS Zeilen gezeigt, damit große Dateien das Fenster nicht einfrieren.

export const MAX_ROWS = 1000

export function detectDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n')
  const counts = [',', ';', '\t', '|'].map((d) => [d, head.split(d).length - 1] as const)
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

/** Zerlegt CSV nach RFC 4180: Felder in Anführungszeichen dürfen Trennzeichen, Zeilenumbrüche und "" enthalten. */
export function parseCsv(text: string, delimiter = detectDelimiter(text), maxRows = Infinity): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (rows.length >= maxRows) return rows
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export function CsvPreview({ text }: { text: string }) {
  const { rows, more } = useMemo(() => {
    const parsed = parseCsv(text, undefined, MAX_ROWS + 1)
    return { rows: parsed.slice(0, MAX_ROWS), more: parsed.length > MAX_ROWS }
  }, [text])
  if (rows.length === 0) return <div className="forge-md forge-csv is-empty" aria-label="CSV preview">The file is empty.</div>
  const [header, ...body] = rows
  const width = Math.max(...rows.map((r) => r.length))
  return (
    <div className="forge-md forge-csv" aria-label="CSV preview">
      <Table aria-label="CSV rows">
        <TableHeader>
          <TableColumn isRowHeader className="forge-csv-no">
            #
          </TableColumn>
          {Array.from({ length: width }, (_, i) => (
            <TableColumn key={i}>{header[i] ?? ''}</TableColumn>
          ))}
        </TableHeader>
        <TableBody>
          {body.map((r, y) => (
            <TableRow key={y}>
              <TableCell className="forge-csv-no">{y + 1}</TableCell>
              {Array.from({ length: width }, (_, x) => (
                <TableCell key={x}>{r[x] ?? ''}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {more ? <p className="forge-field-hint">Only the first {MAX_ROWS} rows are shown.</p> : null}
    </div>
  )
}
