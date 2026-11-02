import { useSyncExternalStore } from 'react'

// Non-blocking notifications: a toast above the status bar that never takes focus away from the
// editor, with optional actions (link, Undo). All notifications are kept in a list for the
// Notifications tab.

export interface NotificationAction {
  label: string
  run: () => void | Promise<void>
}

export interface AppNotification {
  id: number
  text: string
  kind: 'info' | 'success' | 'warning' | 'error'
  actions: NotificationAction[]
  at: string
  /** Still shown as a toast; false once dismissed or timed out, the list entry stays. */
  toast: boolean
}

let items: AppNotification[] = []
let counter = 0
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
  for (const l of listeners) l()
}

export function subscribeNotifications(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getNotifications(): AppNotification[] {
  return items
}

export function notify(text: string, options: { kind?: AppNotification['kind']; actions?: NotificationAction[]; timeoutMs?: number } = {}): number {
  const existing = items.find((n) => n.toast && n.text === text)
  if (existing) return existing.id
  const id = ++counter
  const item: AppNotification = { id, text, kind: options.kind ?? 'info', actions: options.actions ?? [], at: new Date().toISOString(), toast: true }
  items = [...items, item].slice(-200)
  const timeout = options.timeoutMs ?? (options.actions?.length ? 12000 : 6000)
  if (timeout > 0) timers.set(id, setTimeout(() => dismissToast(id), timeout))
  emit()
  return id
}

export function dismissToast(id: number): void {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
  if (!items.some((n) => n.id === id && n.toast)) return
  items = items.map((n) => (n.id === id ? { ...n, toast: false } : n))
  emit()
}

export function clearNotifications(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  items = []
  emit()
}

export function ToastHost() {
  const all = useSyncExternalStore(subscribeNotifications, getNotifications)
  const toasts = all.filter((n) => n.toast).slice(-3)
  if (toasts.length === 0) return null
  return (
    <div className="forge-toasts" role="region" aria-label="Notifications">
      {toasts.map((n) => (
        <div key={n.id} className={`forge-toast is-${n.kind}`} role="status">
          <span className="forge-toast-text">{n.text}</span>
          {n.actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className="forge-toast-action"
              onClick={() => {
                dismissToast(n.id)
                void a.run()
              }}
            >
              {a.label}
            </button>
          ))}
          <button type="button" className="forge-toast-close" aria-label="Dismiss notification" onClick={() => dismissToast(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
