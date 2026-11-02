import { pathKey } from '../platform/pathKey'
import type { DiagnosticDto, ProblemDto } from '../wire/types'

// Single list of everything that is wrong in the open projects: findings of the project scan, the
// live findings of the object being edited, syntax errors of open code editors and failures of
// the last build. Each producer owns one channel and replaces only its own entries; the Problems
// tab, the tree badges, the editor tab badges and the status bar all read from here.

export type ProblemSource = 'parse' | 'validator' | 'reference' | 'js' | 'build'

export interface Problem {
  id: string
  channel: string
  source: ProblemSource
  severity: 'Error' | 'Warning' | 'Info'
  message: string
  /** Tree node id (the object file) the problem belongs to; absent for build-wide problems. */
  nodeId?: string
  object?: string
  objectType?: string
  /** File shown in the Problems tab (object file or linked/code file). */
  file?: string
  line?: number
  column?: number
  path?: string
}

export function normId(id: string): string {
  return pathKey(id)
}

function severityOf(raw: string): Problem['severity'] {
  if (/^error/i.test(raw)) return 'Error'
  if (/^warn/i.test(raw)) return 'Warning'
  return 'Info'
}

export function fromProblemDto(dto: ProblemDto, channel: string): Problem {
  return {
    id: `${channel}|${dto.node_id}|${dto.source}|${dto.path ?? ''}|${dto.line ?? ''}|${dto.message}`,
    channel,
    source: dto.source,
    severity: severityOf(dto.severity),
    message: dto.message,
    nodeId: dto.node_id,
    object: dto.object,
    objectType: dto.object_type,
    file: dto.node_id,
    line: dto.line ?? undefined,
    column: dto.column ?? undefined,
    path: dto.path ?? undefined,
  }
}

export function fromDiagnostic(d: DiagnosticDto, nodeId: string, object: string, channel: string): Problem {
  return {
    id: `${channel}|${nodeId}|validator|${d.path ?? ''}|${d.message}`,
    channel,
    source: 'validator',
    severity: severityOf(d.severity),
    message: d.message,
    nodeId,
    object,
    file: nodeId,
    path: d.path ?? undefined,
  }
}

// `path/File.ext:LINE[:COL] message` lines and error lines of a build log.
const FILE_LINE = /([A-Za-z]:[\\/][^\s:]+|[\w.@\\/-]+\.(?:aod|js|json|xml|ts))\s*[:(](\d+)(?:[:,](\d+))?\)?\s*[:-]?\s*(.*)$/

export function problemsFromBuildLog(text: string): Problem[] {
  const out: Problem[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = FILE_LINE.exec(line)
    const isError = /\b(error|failed|exception)\b/i.test(line)
    if (!m && !isError) continue
    const message = (m?.[4] || line).slice(0, 400)
    const key = `${m?.[1] ?? ''}|${m?.[2] ?? ''}|${message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: `build|${key}`,
      channel: 'build',
      source: 'build',
      severity: /\bwarn/i.test(line) && !/\berror\b/i.test(line) ? 'Warning' : 'Error',
      message,
      file: m?.[1],
      line: m?.[2] ? Number(m[2]) : undefined,
      column: m?.[3] ? Number(m[3]) : undefined,
    })
  }
  return out
}

type Listener = () => void

const channels = new Map<string, Problem[]>()
const listeners = new Set<Listener>()
let snapshot: Problem[] = []

function rebuild() {
  const live = new Set<string>()
  for (const [c, list] of channels) if (c.startsWith('live:')) for (const p of list) if (p.nodeId) live.add(normId(p.nodeId))
  // The live check of an object being edited replaces its (older) scan results.
  snapshot = [...channels.entries()].flatMap(([c, list]) =>
    c.startsWith('scan:') ? list.filter((p) => !(p.source === 'validator' && p.nodeId && live.has(normId(p.nodeId)))) : list,
  )
  listeners.forEach((l) => l())
}

export function setProblems(channel: string, list: Problem[]): void {
  if (list.length === 0) {
    if (!channels.has(channel)) return
    channels.delete(channel)
  } else {
    channels.set(channel, list)
  }
  rebuild()
}

export function clearChannelsWhere(predicate: (channel: string) => boolean): void {
  let changed = false
  for (const c of [...channels.keys()]) {
    if (predicate(c)) {
      channels.delete(c)
      changed = true
    }
  }
  if (changed) rebuild()
}

export function getProblems(): Problem[] {
  return snapshot
}

export function subscribeProblems(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function countsByNode(list: Problem[]): Map<string, { errors: number; warnings: number }> {
  const out = new Map<string, { errors: number; warnings: number }>()
  for (const p of list) {
    if (!p.nodeId) continue
    const key = normId(p.nodeId)
    const c = out.get(key) ?? { errors: 0, warnings: 0 }
    if (p.severity === 'Error') c.errors++
    else if (p.severity === 'Warning') c.warnings++
    out.set(key, c)
  }
  return out
}

export function errorCount(list: Problem[]): number {
  return list.filter((p) => p.severity === 'Error').length
}

export function resetProblemsForTests(): void {
  channels.clear()
  snapshot = []
  listeners.forEach((l) => l())
}
