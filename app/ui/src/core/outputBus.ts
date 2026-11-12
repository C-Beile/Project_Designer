import type { OutputLine, OutputSubTab } from '../shell/OutputPanel'

// Lets editors and dialogs (SQL window, deploy, tunnel) write into the Output window without
// threading a callback through every component. The shell is the only subscriber.

type Listener = (sub: OutputSubTab, lines: OutputLine[]) => void

const listeners = new Set<Listener>()

export function subscribeOutput(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function logOutput(sub: OutputSubTab, text: string, level: OutputLine['level'] = 'info'): void {
  const line: OutputLine = { text: `[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${text}`, level }
  listeners.forEach((l) => l(sub, [line]))
}

// Small requests from editors to the shell (e.g. "show the Services window").
export type ShellRequest = 'services' | 'workspace' | 'rest'

const requestListeners = new Set<(r: ShellRequest) => void>()

export function subscribeShellRequests(listener: (r: ShellRequest) => void): () => void {
  requestListeners.add(listener)
  return () => {
    requestListeners.delete(listener)
  }
}

export function requestShell(request: ShellRequest): void {
  requestListeners.forEach((l) => l(request))
}

// Statements the app sends to a database, in the wording of the original Designer's Database log:
// `HH:MM:SS: ClientPreparedStatement{sql:'...', parameters:[...]} [Nms]`. Values that belong to
// credential columns are masked before they reach the log.
const SECRET_NAME = /(password|passwd|pwd|secret|token|credential|apikey|api_key)/i

export function maskStatement(sql: string): string {
  return sql
    .replace(/(\b[\w`"]*(?:password|passwd|pwd|secret|token|credential)[\w`"]*\s*=\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gi, "$1'***'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function maskParameter(name: string | undefined, value: unknown): string {
  if (name && SECRET_NAME.test(name)) return '***'
  return typeof value === 'string' ? `'${value}'` : String(value)
}

export function logStatement(sql: string, parameters: string[], ms: number, failed = false): void {
  const clock = new Date().toTimeString().slice(0, 8)
  const text = `${clock}: ClientPreparedStatement{sql:'${maskStatement(sql)}', parameters:[${parameters.join(', ')}]} [${Math.max(0, Math.round(ms))}ms]`
  const line: OutputLine = { text, level: failed ? 'error' : 'info' }
  listeners.forEach((l) => l('database', [line]))
}
