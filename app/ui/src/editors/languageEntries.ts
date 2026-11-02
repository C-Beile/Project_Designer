// Entries of a language object (`keyValueMap` of `stringEntry` with `name` = key and `value`), read
// and changed as text of the .aod file. Every byte outside the changed entry stays as it is:
// order, line ends, indentation. Escaping follows the real files: & < > are written as entities,
// quotes and apostrophes stay as they are.

export interface LangEntry {
  name: string
  value: string
  /** Offsets of the whole element including its line. */
  start: number
  end: number
  /** Offsets of the text inside <name> and <value>; `valueAt` is -1 for a self-closing <value/>. */
  nameAt: [number, number]
  valueAt: [number, number] | null
}

export interface LangEntries {
  entries: LangEntry[]
  /** Line start of `</keyValueMap>`: insertion point behind the last entry. */
  closeAt: number
  eol: string
  indent: string
  childIndent: string
}

export function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function lineStart(text: string, offset: number): number {
  const ls = text.lastIndexOf('\n', offset - 1) + 1
  return /^[ \t]*$/.test(text.slice(ls, offset)) ? ls : offset
}

function lineEnd(text: string, offset: number): number {
  const m = /^[ \t]*\r?\n/.exec(text.slice(offset))
  return m ? offset + m[0].length : offset
}

export function parseLanguageEntries(text: string): LangEntries | null {
  const open = text.indexOf('<keyValueMap>')
  const close = text.indexOf('</keyValueMap>')
  if (open < 0 || close < open) return null
  const entries: LangEntry[] = []
  const re = /<stringEntry>([\s\S]*?)<\/stringEntry>/g
  re.lastIndex = open
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && m.index < close) {
    const bodyAt = m.index + '<stringEntry>'.length
    const body = m[1]
    const n = /<name>([\s\S]*?)<\/name>/.exec(body)
    const v = /<value>([\s\S]*?)<\/value>/.exec(body)
    const nameAt: [number, number] = n ? [bodyAt + n.index + '<name>'.length, bodyAt + n.index + '<name>'.length + n[1].length] : [bodyAt, bodyAt]
    const valueAt: [number, number] | null = v ? [bodyAt + v.index + '<value>'.length, bodyAt + v.index + '<value>'.length + v[1].length] : null
    entries.push({
      name: unescapeXml(n ? n[1] : ''),
      value: unescapeXml(v ? v[1] : ''),
      start: lineStart(text, m.index),
      end: lineEnd(text, m.index + m[0].length),
      nameAt,
      valueAt,
    })
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const last = entries[entries.length - 1]
  let indent = '    '
  let childIndent = '      '
  if (last) {
    const line = text.slice(last.start, last.end)
    indent = /^[ \t]*/.exec(line)![0]
    const second = line.split(/\r?\n/)[1] ?? ''
    childIndent = /^[ \t]*/.exec(second)![0] || indent + '  '
  }
  return { entries, closeAt: lineStart(text, close), eol, indent, childIndent }
}

/** Changes key and/or value of one entry; only the text inside <name> / <value> is replaced. */
export function setEntry(text: string, index: number, change: { name?: string; value?: string }): string | null {
  const parsed = parseLanguageEntries(text)
  const e = parsed?.entries[index]
  if (!parsed || !e) return null
  const edits: { at: [number, number]; text: string }[] = []
  if (change.name !== undefined && change.name !== e.name) edits.push({ at: e.nameAt, text: escapeXml(change.name) })
  if (change.value !== undefined && change.value !== e.value) {
    if (e.valueAt) edits.push({ at: e.valueAt, text: escapeXml(change.value) })
    else return null
  }
  if (edits.length === 0) return text
  edits.sort((a, b) => b.at[0] - a.at[0])
  let out = text
  for (const ed of edits) out = out.slice(0, ed.at[0]) + ed.text + out.slice(ed.at[1])
  return out
}

/** Adds an entry behind the last one (or in front of `before`); returns the new text and the index of the new entry. */
export function addEntry(text: string, name = '', value = '', before?: number): { text: string; index: number } | null {
  const p = parseLanguageEntries(text)
  if (!p) return null
  const { eol, indent, childIndent } = p
  const block = `${indent}<stringEntry>${eol}${childIndent}<name>${escapeXml(name)}</name>${eol}${childIndent}<value>${escapeXml(value)}</value>${eol}${indent}</stringEntry>${eol}`
  const index = before !== undefined && p.entries[before] ? before : p.entries.length
  const at = before !== undefined && p.entries[before] ? p.entries[before].start : p.closeAt
  return { text: text.slice(0, at) + block + text.slice(at), index }
}

export function deleteEntry(text: string, index: number): string | null {
  const p = parseLanguageEntries(text)
  const e = p?.entries[index]
  if (!p || !e) return null
  return text.slice(0, e.start) + text.slice(e.end)
}
