import type { DiffTarget } from '../../wire/types'

export const SIDE_LABEL = { unstaged: ['Index', 'Working Tree'], staged: ['HEAD', 'Index'], commit: ['Parent', 'Commit'] } as const

export function diffTitle(target: DiffTarget): string {
  const name = target.path.slice(target.path.lastIndexOf('/') + 1)
  const [from, to] = SIDE_LABEL[target.side]
  return `${name} (${from} ↔ ${to})`
}
