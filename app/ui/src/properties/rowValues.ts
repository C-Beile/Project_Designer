import type { SheetRow, WireValue } from '../wire/types'

export function textOf(v: WireValue | undefined): string | undefined {
  if (!v) return undefined
  if (v.kind === 'text') return v.value
  if (v.kind === 'bool' || v.kind === 'int') return String(v.value)
  return undefined
}

export function listItems(v: WireValue | undefined): string[] {
  if (!v) return []
  if (v.kind === 'array') return v.items.flatMap(listItems)
  if (v.kind === 'object') {
    const name = v.fields.find((f) => f.key === 'name')
    if (name) return [textOf(name.value) ?? '']
    return v.fields.flatMap((f) => listItems(f.value))
  }
  return [textOf(v) ?? '']
}

/** Properties holding an icon id (`iconId`, and `icon` of alias definitions; `VAADIN:HOME`): they get the icon chooser instead of a typed id. */
export function isIconRow(row: SheetRow): boolean {
  return (row.name === 'iconId' || row.name === 'icon') && row.kind !== 'bool' && row.kind !== 'enum' && row.kind !== 'reference' && row.kind !== 'linked'
}

/** The `image` property is a plain path to an image file. */
export function isImageRow(row: SheetRow): boolean {
  return row.name === 'image' && (row.kind === 'text' || row.kind === undefined)
}

export const CONFIG_PATH_ROWS = ['serverConfigPath', 'tunnelConfigPath']

/** Empty and unset values are shown grey italic, as in the original (shot 56). A checked box is a real value; an unchecked one is the default. */
export function isDefaultRow(row: SheetRow): boolean {
  if (!row.set) return true
  if (row.kind === 'bool') return !(row.value?.kind === 'bool' ? row.value.value : textOf(row.value) === 'true')
  return row.display === ''
}
