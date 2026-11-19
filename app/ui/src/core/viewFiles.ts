import type { TreeNode } from '../wire/types'

const MAX_BYTES = 5 * 1024 * 1024
const texts = new Map<string, string>()
let counter = 0

export type ViewFileResult = { ok: true; node: TreeNode } | { ok: false; reason: string }

export function looksBinary(text: string): boolean {
  return text.slice(0, 8000).includes('\u0000')
}

export async function readViewFile(file: File): Promise<ViewFileResult> {
  if (file.size > MAX_BYTES) return { ok: false, reason: `${file.name} is larger than 5 MB and is not opened.` }
  let text: string
  try {
    text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    })
  } catch {
    return { ok: false, reason: `${file.name} cannot be read (a folder?).` }
  }
  if (looksBinary(text)) return { ok: false, reason: `${file.name} is not a text file and is not opened.` }
  const id = `view:${++counter}:${file.name}`
  texts.set(id, text)
  return { ok: true, node: { id, label: file.name, object_type: null, kind: 'view', is_leaf: true, children: [], read_only: true } }
}

export function viewFileText(id: string): string | null {
  return texts.get(id) ?? null
}

export function forgetViewFile(id: string): void {
  texts.delete(id)
}
