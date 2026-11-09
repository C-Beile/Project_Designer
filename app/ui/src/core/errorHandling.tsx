import { Component, useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { isTauriRuntime } from '../chrome/tauriWindow'
import { Modal } from './Modal'
import { logError } from './errorLog'
import { errorText } from './errorText'

// No silent failures: a render crash of one editor shows an error panel inside that editor area
// (the rest of the app keeps working), a crash of the whole shell shows a full-window message, and
// every error is written to the log file in the app data folder (Help > Open Log Folder).

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ''}`
  return String(error)
}

// Browsers report this when a layout pass needed a second frame (Monaco and the dock panels resize
// each other); it is harmless and must neither fill the log nor open an error dialog.
export function isBenignWindowError(message: string): boolean {
  return /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/.test(message)
}

// Monaco's JSON service asks a worker that has no schema handler (resetSchema); the editor keeps
// working, so this must neither fill the log nor open a crash dialog.
export function isBenignRejection(reason: unknown): boolean {
  const text = errorText(reason)
  return /Missing requestHandler or method: (resetSchema|\$?[A-Za-z]*[Ss]chema\w*)/.test(text)
}

function ErrorPanel({ api, title, detail, onRetry }: { api?: ForgeApi; title: string; detail: string; onRetry?: () => void }) {
  return (
    <div className="forge-error-panel" role="alert">
      <h2>{title}</h2>
      <p>This view hit an unexpected error. Your files were not changed. Details were written to the log file.</p>
      <pre className="forge-error-detail">{detail.split('\n').slice(0, 6).join('\n')}</pre>
      <div className="forge-error-actions">
        {onRetry ? (
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        <button type="button" onClick={() => void api?.openLogFolder().catch(() => {})}>
          Open Log Folder
        </button>
      </div>
    </div>
  )
}

/** Kleiner Streifen statt großer Fehlerseite: für Leisten, Panels und Erweiterungen, damit der Rest des Fensters bedienbar bleibt. */
function CompactError({ label, detail, onRetry }: { label: string; detail: string; onRetry: () => void }) {
  return (
    <div className="forge-error-compact" role="alert" title={detail}>
      <span>{label} failed: {detail.split(String.fromCharCode(10))[0].slice(0, 160)}</span>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

export class ErrorBoundary extends Component<{ api?: ForgeApi; label: string; compact?: boolean; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: describe(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const text = `${this.props.label}: ${describe(error)}\ncomponent stack:${info.componentStack ?? ''}`
    // Ohne `api` (Leisten, Panels) geht der Eintrag über die globale Log-Senke.
    if (this.props.api) void this.props.api.logClientError(text)?.catch?.(() => {})
    else logError(text)
  }

  render() {
    if (this.state.error === null) return this.props.children
    if (this.props.compact) return <CompactError label={this.props.label} detail={this.state.error} onRetry={() => this.setState({ error: null })} />
    return <ErrorPanel api={this.props.api} title={`${this.props.label} failed`} detail={this.state.error} onRetry={() => this.setState({ error: null })} />
  }
}

// Catches what no boundary can: errors in event handlers and rejected promises, plus panics of the
// Rust side (event `forge://panic`). The user gets a dialog instead of a silently dead button.
export function CrashListener({ api }: { api: ForgeApi }) {
  const [crash, setCrash] = useState<{ message: string; log?: string } | null>(null)

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isBenignWindowError(e.message ?? '')) {
        e.stopImmediatePropagation()
        return
      }
      void api.logClientError(`window error: ${describe(e.error ?? e.message)}\nstelle: ${e.filename || '?'}:${e.lineno}:${e.colno}`)?.catch?.(() => {})
      setCrash({ message: e.message || 'Unexpected error in the user interface.' })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isBenignRejection(e.reason)) {
        e.preventDefault()
        return
      }
      void api.logClientError(`unhandled promise rejection: ${describe(e.reason)}`)?.catch?.(() => {})
      setCrash({ message: e.reason instanceof Error ? e.reason.message : String(e.reason) })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    let unlisten: (() => void) | undefined
    if (isTauriRuntime()) {
      void import('@tauri-apps/api/event')
        .then((m) => m.listen<{ message: string; log: string }>('forge://panic', (ev) => setCrash({ message: ev.payload.message, log: ev.payload.log })))
        .then((u) => {
          unlisten = u
        })
        .catch(() => {})
    }
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      unlisten?.()
    }
  }, [api])

  if (!crash) return null
  return (
    <Modal
      title="Unexpected error"
      onClose={() => setCrash(null)}
      footer={
        <>
          <button type="button" onClick={() => void api.openLogFolder().catch(() => {})}>
            Open Log Folder
          </button>
          <button type="button" onClick={() => setCrash(null)}>
            Close
          </button>
        </>
      }
    >
      <p>Something went wrong. Your files on disk were not changed by this error; unsaved edits are still open.</p>
      <pre className="forge-error-detail">{crash.message.slice(0, 400)}</pre>
      {crash.log ? <p className="forge-field-hint">Details: {crash.log}</p> : <p className="forge-field-hint">Details were written to the log file.</p>}
    </Modal>
  )
}
