import { SHEET_CATEGORIES, SHEET_MODELS, SHEET_TABS, type SheetModelEntry, type SheetModelProp } from './sheetModel.generated'
import type { PropKind, PropertySheet, SheetGroup, SheetRow } from '../wire/types'

// Arranges the rows of a property sheet into the tabs (SheetTab) and categories (SheetTabCategory) of the
// original Designer. The model comes from the generated specification data (sheetModel.generated.ts); the
// rows and their values still come from the backend, so editing works as before.

export type SheetLang = 'en' | 'de'

export interface SheetTabView {
  id: string
  label: string
  groups: SheetGroup[]
}

export interface SheetLayout {
  tabs: SheetTabView[]
  /** Name of the data model the layout followed, or null when the type is not in the specification. */
  modelKey: string | null
}

const UNKNOWN_RANK = 1_000_000

const tabIndex = new Map(SHEET_TABS.map((t, i) => [t[0], i]))
const categoryIndex = new Map(SHEET_CATEGORIES.map((c, i) => [c[0], i]))

const modelByTag = new Map<string, string>(Object.keys(SHEET_MODELS).map((k) => [k.replace(/DataModel$/, '').toLowerCase(), k]))

/** Data model of an element type as the sheet names it (`entity`, `neonView`, `dbRecordFieldMapping`, ...). */
export function modelKeyFor(typeLabel: string): string | null {
  const tag = typeLabel.replace(/Type$/, '').toLowerCase()
  return modelByTag.get(tag) ?? null
}

export function modelEntry(key: string): SheetModelEntry | undefined {
  return SHEET_MODELS[key]
}

export function tabTitle(id: string, lang: SheetLang = 'en'): string {
  const tab = SHEET_TABS.find((t) => t[0] === id)
  if (!tab) return humanize(id)
  const own = (lang === 'de' ? tab[3] : tab[2]) || tab[2] || humanize(id)
  return own
}

export function categoryTitle(id: string, lang: SheetLang = 'en'): string {
  const c = SHEET_CATEGORIES.find((x) => x[0] === id)
  if (!c) return humanize(id)
  return (lang === 'de' ? c[2] : c[1]) || c[1]
}

function humanize(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

const KIND_OF_EDITOR: Record<string, PropKind> = {
  LINKED: 'linked',
  SIMPLE_LIST: 'list',
  ENTITIES: 'list',
  ONELINE_TEXT: 'text',
}

function missingRow(prop: SheetModelProp, descriptions: Record<string, string> | undefined): SheetRow {
  return {
    name: prop[0],
    kind: KIND_OF_EDITOR[prop[4]] ?? 'text',
    display: '',
    set: false,
    editable: false,
    reason: 'Not editable: the property catalog of the Designer installation is not available',
    typed: false,
    description: descriptions?.[`${prop[6]}.${prop[0]}`],
  }
}

/**
 * Tabs and categories of a sheet. Rows keep their editors and values; only their place changes:
 * tab and category from the model, order by category, then position. Rows the model does not know stay
 * in the category the backend gave them. Types missing from the model keep the backend's groups untouched.
 */
export function layoutSheet(sheet: PropertySheet, lang: SheetLang = 'en', descriptions?: Record<string, string>): SheetLayout {
  const key = modelKeyFor(sheet.type_label)
  const model = key ? SHEET_MODELS[key] : undefined
  if (!key || !model) {
    return { tabs: [{ id: 'PROPERTIES', label: tabTitle('PROPERTIES', lang), groups: sheet.groups }], modelKey: null }
  }

  const info = new Map<string, SheetModelProp>(model.props.map((p) => [p[0], p]))
  const backendRank = new Map<string, number>(sheet.groups.map((g, i) => [g.key, i]))
  const entries: { row: SheetRow; tab: string; category: string; position: number; order: number }[] = []
  const present = new Set<string>()
  let order = 0

  for (const group of sheet.groups) {
    for (const row of group.rows) {
      present.add(row.name)
      const prop = info.get(row.name)
      const description = row.description ?? (prop ? descriptions?.[`${prop[6]}.${prop[0]}`] : undefined)
      entries.push({
        row: description !== row.description ? { ...row, description } : row,
        tab: prop?.[1] ?? 'PROPERTIES',
        category: prop?.[2] ?? group.key,
        position: prop ? prop[3] : UNKNOWN_RANK,
        order: order++,
      })
    }
  }

  // Without the Designer installation the backend lists stored values only; the model then supplies the
  // remaining properties as unset, read-only rows so the sheet still shows what the object can have.
  if (sheet.catalog_missing) {
    for (const prop of model.props) {
      if (present.has(prop[0])) continue
      entries.push({ row: missingRow(prop, descriptions), tab: prop[1], category: prop[2], position: prop[3], order: order++ })
    }
  }

  const categoryRank = (id: string) => {
    const fromBackend = backendRank.get(id)
    if (fromBackend !== undefined) return fromBackend
    const fromEnum = categoryIndex.get(id)
    return 1000 + (fromEnum ?? UNKNOWN_RANK)
  }

  const byTab = new Map<string, Map<string, SheetRow[]>>()
  const sorted = [...entries].sort((a, b) => a.position - b.position || a.order - b.order)
  for (const e of sorted) {
    const cats = byTab.get(e.tab) ?? new Map<string, SheetRow[]>()
    const rows = cats.get(e.category) ?? []
    rows.push(e.row)
    cats.set(e.category, rows)
    byTab.set(e.tab, cats)
  }

  const tabs: SheetTabView[] = [...byTab.entries()]
    .sort((a, b) => (tabIndex.get(a[0]) ?? UNKNOWN_RANK) - (tabIndex.get(b[0]) ?? UNKNOWN_RANK))
    .map(([id, cats]) => ({
      id,
      label: tabLabel(id, lang),
      groups: [...cats.entries()]
        .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
        .map(([cat, rows]) => ({ key: cat, label: categoryTitle(cat, lang), rows })),
    }))

  return { tabs, modelKey: key }
}

function tabLabel(id: string, lang: SheetLang): string {
  const tab = SHEET_TABS.find((t) => t[0] === id)
  const own = tabTitle(id, lang)
  return tab?.[1] ? `${tabTitle(tab[1], lang)} / ${own}` : own
}
