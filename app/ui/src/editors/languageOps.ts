import { addEntry, deleteEntry, parseLanguageEntries, setEntry } from './languageEntries'

// Operations over whole language files, built on the text functions of `languageEntries.ts`.

/** Removes every entry whose key is in `keys`; returns the new text and how many entries went. */
export function removeKeysPlan(text: string, keys: Set<string>): { text: string; removed: number } {
  let out = text
  let removed = 0
  for (;;) {
    const p = parseLanguageEntries(out)
    const i = p ? p.entries.findIndex((e) => keys.has(e.name)) : -1
    if (!p || i < 0) break
    const next = deleteEntry(out, i)
    if (next === null) break
    out = next
    removed += 1
  }
  return { text: out, removed }
}

/**
 * Takes over from `fromText`: keys that are missing here are added behind the last entry, entries
 * here with an empty value get the value of the other file. Existing values are never replaced.
 */
export function copyValuesPlan(toText: string, fromText: string): { text: string; added: number; filled: number } {
  const to = parseLanguageEntries(toText)
  const from = parseLanguageEntries(fromText)
  if (!to || !from) return { text: toText, added: 0, filled: 0 }
  const fromByKey = new Map<string, string>()
  for (const e of from.entries) if (!fromByKey.has(e.name)) fromByKey.set(e.name, e.value)
  let text = toText
  let filled = 0
  const have = new Set<string>()
  to.entries.forEach((e, i) => {
    have.add(e.name)
    const v = fromByKey.get(e.name)
    if (e.value === '' && v) {
      const next = setEntry(text, i, { value: v })
      if (next !== null && next !== text) {
        text = next
        filled += 1
      }
    }
  })
  let added = 0
  for (const [k, v] of fromByKey) {
    if (have.has(k)) continue
    const r = addEntry(text, k, v)
    if (r) {
      text = r.text
      added += 1
    }
  }
  return { text, added, filled }
}
