import { useCallback, useMemo } from 'react'
import { ListDialog, type ListItem } from '../core/ui'

// File > Open (Ctrl+O, manual 4.1 "Open/Search for one data model in a project"): type a part of
// the name, `*` works as a wildcard, Enter or a double click opens the model.

export interface ModelEntry {
  type: string
  name: string
}

export function matchModels(models: ModelEntry[], query: string, limit = 200): ModelEntry[] {
  const q = query.trim()
  if (!q) return models.slice(0, limit)
  const pattern = new RegExp(q.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i')
  return models.filter((m) => pattern.test(m.name)).slice(0, limit)
}

export function OpenModelDialog({ models, onPick, onClose }: { models: ModelEntry[]; onPick: (m: ModelEntry) => void; onClose: () => void }) {
  const items = useMemo<ListItem<ModelEntry>[]>(() => models.map((m) => ({ id: `${m.type}:${m.name}`, label: m.name, hint: m.type, data: m })), [models])
  const filter = useCallback(
    (all: ListItem<ModelEntry>[], query: string) => {
      const hits = new Set(matchModels(models, query))
      return all.filter((i) => hits.has(i.data!))
    },
    [models],
  )
  return (
    <ListDialog
      title="Open"
      items={items}
      filter={filter}
      searchLabel="Data model"
      searchAriaLabel="Data model name"
      searchPlaceholder="Name, * as wildcard"
      listLabel="Matching data models"
      emptyText="No data model matches."
      okLabel="Open"
      onPick={([m]) => m.data && onPick(m.data)}
      onCancel={onClose}
    />
  )
}
