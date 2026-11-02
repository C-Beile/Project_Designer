// Text-level editing of the navigation tree of `____SYSTEM_APPLICATION_NEON.aod`. The file stays
// byte-faithful: only the lines of the moved, added or removed `entityNode` elements change, the
// indentation and line endings of the file are kept. All edits work on the raw text and are applied
// through the same "replace source" path the Source tab uses.

export const KIND_ROOT = 200
export const KIND_GROUP = 123
export const KIND_CONTEXT = 10077
export const KIND_DASHBOARD = 10090
export const KIND_ROLE = 159

export interface AppNode {
  name: string
  kind: number | null
  title: string | null
  icon: string | null
  children: AppNode[]
  /** Offsets of the whole element including its indentation and the line break after it. */
  start: number
  end: number
  /** Index of the line start of the closing `</childNodes>` (insertion point for a new last child). */
  childrenEnd: number | null
  /** Offset of the `<childNodes>` line start and the end after `</childNodes>` line. */
  childrenStart: number | null
  childrenBlockEnd: number | null
  depth: number
}

const TAG = /<(\/?)entityNode(\s[^>]*)?(\/?)>/g

function lineStart(text: string, offset: number): number {
  const ls = text.lastIndexOf('\n', offset - 1) + 1
  return /^[ \t]*$/.test(text.slice(ls, offset)) ? ls : offset
}

function lineEnd(text: string, offset: number): number {
  const m = /^[ \t]*\r?\n/.exec(text.slice(offset))
  return m ? offset + m[0].length : offset
}

function ownField(text: string, node: { start: number; end: number }, childrenAt: number | null, tag: string): string | null {
  const end = childrenAt ?? node.end
  const body = text.slice(node.start, end)
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(body)
  return m ? unescapeXml(m[1]) : null
}

export function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function parseApplicationTree(text: string): AppNode | null {
  const stack: AppNode[] = []
  let root: AppNode | null = null
  TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG.exec(text))) {
    const closing = m[1] === '/'
    const selfClosing = m[3] === '/'
    if (!closing) {
      const node: AppNode = {
        name: '',
        kind: null,
        title: null,
        icon: null,
        children: [],
        start: lineStart(text, m.index),
        end: -1,
        childrenEnd: null,
        childrenStart: null,
        childrenBlockEnd: null,
        depth: stack.length,
      }
      const parent = stack[stack.length - 1]
      if (parent) parent.children.push(node)
      else root = root ?? node
      if (selfClosing) node.end = lineEnd(text, m.index + m[0].length)
      else stack.push(node)
    } else {
      const node = stack.pop()
      if (!node) return null
      node.end = lineEnd(text, m.index + m[0].length)
    }
  }
  if (!root || stack.length > 0) return null
  const fill = (node: AppNode) => {
    const cs = text.indexOf('<childNodes>', node.start)
    const hasChildren = node.children.length > 0 && cs >= 0 && cs < node.end
    const first = node.children[0]
    const childrenAt = hasChildren && first ? Math.min(cs, first.start) : null
    node.name = ownField(text, node, childrenAt, 'name') ?? ''
    const kind = new RegExp('<kind v="(\\d+)"').exec(text.slice(node.start, childrenAt ?? node.end))
    node.kind = kind ? Number(kind[1]) : null
    node.title = ownField(text, node, childrenAt, 'title')
    node.icon = ownField(text, node, childrenAt, 'icon')
    if (hasChildren && first) {
      const last = node.children[node.children.length - 1]
      const closeIdx = text.indexOf('</childNodes>', last.end)
      node.childrenStart = lineStart(text, cs)
      node.childrenEnd = lineStart(text, closeIdx)
      node.childrenBlockEnd = lineEnd(text, closeIdx + '</childNodes>'.length)
    }
    node.children.forEach(fill)
  }
  fill(root)
  return root
}

export function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

export function nodeAt(root: AppNode, path: number[]): AppNode | null {
  let node: AppNode | null = root
  for (const i of path) node = node?.children[i] ?? null
  return node
}

function indentOf(text: string, offset: number): number {
  const m = /^[ \t]*/.exec(text.slice(offset))
  return m ? m[0].length : 0
}

function reindent(block: string, delta: number): string {
  if (delta === 0) return block
  return block
    .split(/(?<=\n)/)
    .map((line) => {
      if (!line.trim()) return line
      if (delta > 0) return ' '.repeat(delta) + line
      const lead = /^ */.exec(line)![0].length
      return line.slice(Math.min(lead, -delta))
    })
    .join('')
}

export function newNodeXml(kind: number, name: string, indent: number, eol: string, title?: string): string {
  const pad = (n: number) => ' '.repeat(n)
  const lines = [`${pad(indent)}<entityNode>`, `${pad(indent + 2)}<name>${escapeXml(name)}</name>`, `${pad(indent + 2)}<kind v="${kind}" />`]
  if (title !== undefined) lines.push(`${pad(indent + 2)}<title>${escapeXml(title)}</title>`)
  lines.push(`${pad(indent)}</entityNode>`)
  return lines.join(eol) + eol
}

function descendant(parent: AppNode, child: AppNode): boolean {
  return parent === child || parent.children.some((c) => descendant(c, child))
}

// Inserts `block` (at the indentation of the target children) as child `index` of `parent`.
function insertBlock(text: string, parent: AppNode, index: number, make: (indent: number) => string): string {
  const eol = eolOf(text)
  const sibling = parent.children[index]
  if (sibling) return text.slice(0, sibling.start) + make(indentOf(text, sibling.start)) + text.slice(sibling.start)
  if (parent.childrenEnd !== null) {
    const first = parent.children[0]
    return text.slice(0, parent.childrenEnd) + make(first ? indentOf(text, first.start) : indentOf(text, parent.childrenEnd) + 2) + text.slice(parent.childrenEnd)
  }
  const closeAt = text.lastIndexOf('</entityNode>', parent.end)
  const closeLine = lineStart(text, closeAt)
  const base = indentOf(text, parent.start)
  const open = `${' '.repeat(base + 2)}<childNodes>${eol}`
  const close = `${' '.repeat(base + 2)}</childNodes>${eol}`
  return text.slice(0, closeLine) + open + make(base + 4) + close + text.slice(closeLine)
}

function removeBlock(text: string, parent: AppNode, child: AppNode): string {
  if (parent.children.length === 1 && parent.childrenStart !== null && parent.childrenBlockEnd !== null) {
    return text.slice(0, parent.childrenStart) + text.slice(parent.childrenBlockEnd)
  }
  return text.slice(0, child.start) + text.slice(child.end)
}

export function addChild(text: string, parentPath: number[], index: number, kind: number, name: string, title?: string): string | null {
  const root = parseApplicationTree(text)
  const parent = root && nodeAt(root, parentPath)
  if (!root || !parent) return null
  const eol = eolOf(text)
  return insertBlock(text, parent, Math.min(index, parent.children.length), (indent) => newNodeXml(kind, name, indent, eol, title))
}

export function removeNode(text: string, path: number[]): string | null {
  if (path.length === 0) return null
  const root = parseApplicationTree(text)
  const parent = root && nodeAt(root, path.slice(0, -1))
  const node = root && nodeAt(root, path)
  if (!root || !parent || !node) return null
  return removeBlock(text, parent, node)
}

// Moves a node (with its whole subtree) to position `index` of `targetParentPath`; refuses to move a
// node into itself. `index` refers to the target parent's children before the move.
export function moveNode(text: string, from: number[], targetParentPath: number[], index: number): string | null {
  if (from.length === 0) return null
  const root = parseApplicationTree(text)
  if (!root) return null
  const node = nodeAt(root, from)
  const oldParent = nodeAt(root, from.slice(0, -1))
  const target = nodeAt(root, targetParentPath)
  if (!node || !oldParent || !target || descendant(node, target)) return null
  const sameParent = oldParent === target
  const oldIndex = from[from.length - 1]
  let at = Math.min(index, target.children.length)
  if (sameParent && (at === oldIndex || at === oldIndex + 1)) return text
  const block = text.slice(node.start, node.end)
  const without = removeBlock(text, oldParent, node)
  const rootAfter = parseApplicationTree(without)
  if (!rootAfter) return null
  // Path of the target after the removal: only a removed earlier sibling on the way shifts it.
  const adjusted = [...targetParentPath]
  const depth = from.length - 1
  if (adjusted.length > depth && adjusted.slice(0, depth).every((v, i) => v === from[i]) && adjusted[depth] > oldIndex) adjusted[depth] -= 1
  const targetAfter = nodeAt(rootAfter, adjusted)
  if (!targetAfter) return null
  if (sameParent && at > oldIndex) at -= 1
  const oldIndent = indentOf(text, node.start)
  return insertBlock(without, targetAfter, Math.min(at, targetAfter.children.length), (indent) => reindent(block, indent - oldIndent))
}

// Replaces or adds `<title>`/`<icon>` of a node; the element order of the file is kept
// (`name`, `kind`, `title`, `icon`, `childNodes`).
export function setNodeField(text: string, path: number[], field: 'title' | 'icon', value: string): string | null {
  const root = parseApplicationTree(text)
  const node = root && nodeAt(root, path)
  if (!root || !node) return null
  const own = node.childrenStart ?? node.end
  const body = text.slice(node.start, own)
  const eol = eolOf(text)
  const existing = new RegExp(`<${field}>[^<]*</${field}>`).exec(body)
  const next = `<${field}>${escapeXml(value)}</${field}>`
  if (existing) return text.slice(0, node.start + existing.index) + next + text.slice(node.start + existing.index + existing[0].length)
  const anchorTag = field === 'icon' ? /<title>[^<]*<\/title>|<kind v="\d+" \/>/g : /<kind v="\d+" \/>/g
  let anchor: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = anchorTag.exec(body))) anchor = m
  if (!anchor) return null
  const at = node.start + anchor.index + anchor[0].length
  const indent = indentOf(text, node.start) + 2
  return text.slice(0, at) + eol + ' '.repeat(indent) + next + text.slice(at)
}

export function nextGroupName(root: AppNode): string {
  const used = new Set<string>()
  const walk = (n: AppNode) => {
    used.add(n.name)
    n.children.forEach(walk)
  }
  walk(root)
  let i = 1
  while (used.has(`Group${i}`)) i += 1
  return `Group${i}`
}

export interface RefIssue {
  path: number[]
  message: string
}

// Checks that every context, dashboard and role node points at an existing object. Role names that
// start with `INTERNAL_` belong to the platform and are not project objects.
export function validateReferences(root: AppNode, known: { contexts: Set<string>; dashboards: Set<string>; roles: Set<string> }): RefIssue[] {
  const issues: RefIssue[] = []
  const walk = (n: AppNode, path: number[]) => {
    if (n.kind === KIND_CONTEXT && !known.contexts.has(n.name)) issues.push({ path, message: `Context '${n.name}' not found` })
    if (n.kind === KIND_DASHBOARD && !known.dashboards.has(n.name)) issues.push({ path, message: `Dashboard '${n.name}' not found` })
    if (n.kind === KIND_ROLE && !n.name.startsWith('INTERNAL_') && !known.roles.has(n.name)) issues.push({ path, message: `Role '${n.name}' not found` })
    n.children.forEach((c, i) => walk(c, [...path, i]))
  }
  walk(root, [])
  return issues
}
