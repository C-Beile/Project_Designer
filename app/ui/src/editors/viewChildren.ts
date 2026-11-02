// Document order of the `children` of a neonView, read from the .aod text. The property tree groups
// children by element name (all neonViewReference together, ...), the file keeps them mixed in the
// order the client shows them; the preview follows the file. Reordering moves the lines of one child
// element, every other line stays byte for byte as it is.

export interface ViewChild {
  kind: string
  name: string
  /** Line start of the element and the end after its closing line. */
  start: number
  end: number
}

export interface ViewChildren {
  children: ViewChild[]
  /** Line start of `</children>`: insertion point behind the last child. */
  closeAt: number
}

const TAG = /<(\/?)([A-Za-z][\w.:-]*)(\s[^>]*?)?(\/?)>/g

function lineStart(text: string, offset: number): number {
  const ls = text.lastIndexOf('\n', offset - 1) + 1
  return /^[ \t]*$/.test(text.slice(ls, offset)) ? ls : offset
}

function lineEnd(text: string, offset: number): number {
  const m = /^[ \t]*\r?\n/.exec(text.slice(offset))
  return m ? offset + m[0].length : offset
}

export function parseViewChildren(text: string): ViewChildren | null {
  const stack: string[] = []
  const found: ViewChild[] = []
  let open: { kind: string; start: number } | null = null
  let closeAt = -1
  TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG.exec(text))) {
    if (m[0].startsWith('<?') || m[0].startsWith('<!')) continue
    const closing = m[1] === '/'
    const selfClosing = m[4] === '/'
    const name = m[2]
    if (!closing) {
      if (stack.length === 2 && stack[1] === 'children') {
        if (selfClosing) found.push({ kind: name, name: '', start: lineStart(text, m.index), end: lineEnd(text, m.index + m[0].length) })
        else open = { kind: name, start: lineStart(text, m.index) }
      }
      if (!selfClosing) stack.push(name)
    } else {
      stack.pop()
      if (stack.length === 2 && stack[1] === 'children' && open && name === open.kind) {
        const end = lineEnd(text, m.index + m[0].length)
        const own = /<name>([^<]*)<\/name>/.exec(text.slice(open.start, end))
        found.push({ kind: open.kind, name: own ? own[1] : '', start: open.start, end })
        open = null
      }
      if (stack.length === 1 && name === 'children') {
        closeAt = lineStart(text, m.index)
        break
      }
    }
  }
  return closeAt < 0 ? null : { children: found, closeAt }
}

/** Moves child `from` in front of child `to` (indexes in document order, before the move). */
export function moveViewChild(text: string, from: number, to: number): string | null {
  const parsed = parseViewChildren(text)
  if (!parsed || !parsed.children[from] || to < 0 || to > parsed.children.length) return null
  if (to === from || to === from + 1) return text
  const node = parsed.children[from]
  const block = text.slice(node.start, node.end)
  const at = parsed.children[to]?.start ?? parsed.closeAt
  const without = text.slice(0, node.start) + text.slice(node.end)
  const shifted = at > node.start ? at - block.length : at
  return without.slice(0, shifted) + block + without.slice(shifted)
}
