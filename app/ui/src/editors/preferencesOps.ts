// Edits of _____PREFERENCES_PROJECT that the property write path cannot do: it only changes a value
// that already exists as plain text. These functions change the model text itself, so a custom
// property that has no <property> element yet can get one, and typed values (true/false, numbers,
// written as v="...") can be changed. Everything else in the text stays byte for byte as it was.

export type PropertyShape = 'text' | 'bool' | 'int'

export const CUSTOM_BANKS = ['customProperties', 'customConfigProperties'] as const
export type CustomBank = (typeof CUSTOM_BANKS)[number]

export function shapeOfTag(tag: string): PropertyShape {
  if (tag === 'customBooleanProperty') return 'bool'
  if (tag === 'customIntegerProperty') return 'int'
  return 'text'
}

const escText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (t: string) => escText(t).replace(/"/g, '&quot;')

export function isValidValue(shape: PropertyShape, value: string): boolean {
  if (shape === 'bool') return value === 'true' || value === 'false'
  if (shape === 'int') return /^-?\d+$/.test(value.trim())
  return true
}

function render(tag: string, shape: PropertyShape, value: string): string {
  return shape === 'text' ? `<${tag}>${escText(value)}</${tag}>` : `<${tag} v="${escAttr(value.trim())}" />`
}

/** Replaces the <property> child of one custom property element, or adds it when the element has none. */
function editPropertyChild(element: string, tag: string, shape: PropertyShape, value: string): string {
  const next = render('property', shape, value)
  const typed = /<property\b[^>]*\bv="[^"]*"[^>]*\/>/
  const text = /<property>[\s\S]*?<\/property>/
  const empty = /<property\s*\/>/
  for (const re of [typed, text, empty]) {
    if (re.test(element)) return element.replace(re, () => next)
  }
  const close = new RegExp(`(\\r?\\n)([ \\t]*)</${tag}>\\s*$`).exec(element)
  const nameLine = /\r?\n([ \t]*)<name>/.exec(element)
  if (close) {
    const indent = nameLine ? nameLine[1] : `${close[2]}  `
    return `${element.slice(0, close.index)}${close[1]}${indent}${next}${close[1]}${close[2]}</${tag}>`
  }
  return element.replace(new RegExp(`</${tag}>\\s*$`), () => `${next}</${tag}>`)
}

/**
 * Sets the value of the `index`-th element `<tag>` inside `<bank>` (custom properties of the project or
 * of the config). Returns the new model text, or null when the value does not fit the kind of the
 * property or the element cannot be found.
 */
export function setCustomProperty(source: string, bank: CustomBank, tag: string, index: number, value: string): string | null {
  const shape = shapeOfTag(tag)
  if (!isValidValue(shape, value)) return null
  const bankMatch = new RegExp(`<${bank}\\b[^>]*>[\\s\\S]*?</${bank}>`).exec(source)
  if (!bankMatch) return null
  const bankText = bankMatch[0]
  const bankStart = bankMatch.index
  const items = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g')
  let found: RegExpExecArray | null = null
  for (let i = 0; i <= index; i++) {
    found = items.exec(bankText)
    if (!found) return null
  }
  const element = found![0]
  const at = bankStart + found!.index
  return source.slice(0, at) + editPropertyChild(element, tag, shape, value) + source.slice(at + element.length)
}

/**
 * Sets a top-level property that already exists in the model (`<name v="..." />` or `<name>text</name>`).
 * Returns null when the property is not in the text yet or the value does not fit.
 */
export function setTopLevelValue(source: string, name: string, shape: PropertyShape, value: string): string | null {
  if (!isValidValue(shape, value)) return null
  const re = new RegExp(`(\\r?\\n  )<${name}\\b(?:[^>]*?/>|[^>]*>[\\s\\S]*?</${name}>)`)
  const m = re.exec(source)
  if (!m) return null
  return source.slice(0, m.index) + m[1] + render(name, shape, value) + source.slice(m.index + m[0].length)
}
