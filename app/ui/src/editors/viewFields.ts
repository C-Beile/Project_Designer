import { parseViewChildren } from './viewChildren'

// Text edits of a neonView that insert elements: an entity field into a ViewTemplate (as a field
// of Generic/ScoreCard or as a column of the table family) and a reference to another view. Every
// other line of the file stays as it is. The element names are the ones the real view files use
// (checked on the project corpus); a template without its field list is refused rather than getting
// a guessed position for a new list.

interface FieldList {
  container: 'columns' | 'fields'
  entry: string
}

const TABLE_COLUMN: FieldList = { container: 'columns', entry: 'neonTableColumn' }

const FIELD_LISTS: Record<string, FieldList> = {
  genericViewTemplate: { container: 'fields', entry: 'entityFieldLink' },
  scoreCardViewTemplate: { container: 'fields', entry: 'entityFieldLink' },
  tableViewTemplate: TABLE_COLUMN,
  cardTableViewTemplate: TABLE_COLUMN,
  ganttViewTemplate: TABLE_COLUMN,
  multiEditTableViewTemplate: TABLE_COLUMN,
  treeTableViewTemplate: { container: 'columns', entry: 'neonTreeTableColumn' },
  genericMultipleViewTemplate: { container: 'columns', entry: 'neonGenericMultipleTableColumn' },
  titledListViewTemplate: { container: 'columns', entry: 'neonTitledListTableColumn' },
  dynamicMultiDataChartViewTemplate: { container: 'columns', entry: 'neonDynamicMultiDataChartColumn' },
  dynamicSingleDataChartViewTemplate: { container: 'columns', entry: 'neonDynamicSingleDataChartColumn' },
}

/** Whether entity fields can be dropped into this kind of ViewTemplate. */
export function acceptsEntityFields(kind: string): boolean {
  return kind in FIELD_LISTS
}

export type EditResult = { text: string } | { error: string }

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function lineStartOf(text: string, at: number): number {
  return text.lastIndexOf('\n', at - 1) + 1
}

function indentAt(text: string, lineStart: number): string {
  return /^[ \t]*/.exec(text.slice(lineStart))![0]
}

function entryText(tag: string, id: string, indent: string, unit: string, eol: string, entityField: string): string {
  return [`${indent}<${tag}>`, `${indent}${unit}<name>${id}</name>`, `${indent}${unit}<entityField>${entityField}</entityField>`, `${indent}</${tag}>`].join(eol) + eol
}

/**
 * Adds `entityField` to the field list of the template `kind`/`name`: in front of entry `before`
 * (index in the list) or at the end. The same field is not added twice.
 */
export function addEntityFieldToTemplate(text: string, kind: string, name: string, entityField: string, newId: string, before: number | null = null): EditResult {
  const list = FIELD_LISTS[kind]
  if (!list) return { error: `${kind} has no list of entity fields.` }
  if (!/^[\w#.$-]+$/.test(entityField)) return { error: `'${entityField}' is not a valid entity field name.` }
  const parsed = parseViewChildren(text)
  const child = parsed?.children.find((c) => c.kind === kind && c.name === name)
  if (!child) return { error: `The template ${name} was not found in this view.` }
  const block = text.slice(child.start, child.end)
  const eol = eolOf(text)
  const open = new RegExp(`<${list.container}(\\s*/>|>)`).exec(block)
  if (!open) return { error: `${name} has no ${list.container} yet; add its first field in the Properties panel.` }
  const openAt = child.start + open.index
  const openLine = lineStartOf(text, openAt)
  const baseIndent = indentAt(text, openLine)
  const unit = '  '
  if (open[1] !== '>') {
    const selfEnd = openAt + open[0].length
    const lineEndAt = text.indexOf('\n', selfEnd)
    const tail = text.slice(selfEnd, lineEndAt < 0 ? text.length : lineEndAt)
    const replacement = `<${list.container}>${eol}${entryText(list.entry, newId, baseIndent + unit, unit, eol, entityField)}${baseIndent}</${list.container}>`
    return { text: text.slice(0, openAt) + replacement + tail + (lineEndAt < 0 ? '' : text.slice(lineEndAt)) }
  }
  const closeTag = `</${list.container}>`
  const closeAt = text.indexOf(closeTag, openAt)
  if (closeAt < 0 || closeAt >= child.end) return { error: `${name} has a damaged ${list.container} list.` }
  const inner = text.slice(openAt + open[0].length, closeAt)
  const entries = [...inner.matchAll(new RegExp(`<${list.entry}>[\\s\\S]*?</${list.entry}>`, 'g'))]
  const existing = entries.map((m) => /<entityField>([^<]*)<\/entityField>/.exec(m[0])?.[1])
  if (existing.includes(entityField)) return { error: `${entityField} is already in ${name}.` }
  const closeLine = lineStartOf(text, closeAt)
  if (!/^[ 	]*$/.test(text.slice(closeLine, closeAt))) return { error: `The ${list.container} list of ${name} is not formatted one entry per line; edit it in the Source tab.` }
  const entryIndent = entries.length > 0 ? indentAt(text, lineStartOf(text, openAt + open[0].length + entries[0].index!)) : baseIndent + unit
  const target = before !== null && entries[before] ? lineStartOf(text, openAt + open[0].length + entries[before].index!) : closeLine
  return { text: text.slice(0, target) + entryText(list.entry, newId, entryIndent, unit, eol, entityField) + text.slice(target) }
}

/** Adds a reference to `view` at the end of the view's children (the `entityField` is the consumer field, `#ENTITY` for the main data). */
export function addViewReference(text: string, view: string, newId: string, entityField = '#ENTITY'): EditResult {
  if (!/^[\w.-]+$/.test(view)) return { error: `'${view}' is not a valid view name.` }
  if (!/^[\w#.$-]+$/.test(entityField)) return { error: `'${entityField}' is not a valid entity field name.` }
  const parsed = parseViewChildren(text)
  if (!parsed) return { error: 'This view has no children list to add to.' }
  const eol = eolOf(text)
  const last = parsed.children[parsed.children.length - 1]
  const indent = last ? indentAt(text, last.start) : indentAt(text, parsed.closeAt) + '  '
  const unit = '  '
  const block = [`${indent}<neonViewReference>`, `${indent}${unit}<name>${newId}</name>`, `${indent}${unit}<entityField>${entityField}</entityField>`, `${indent}${unit}<view>${view}</view>`, `${indent}</neonViewReference>`].join(eol) + eol
  return { text: text.slice(0, parsed.closeAt) + block + text.slice(parsed.closeAt) }
}
