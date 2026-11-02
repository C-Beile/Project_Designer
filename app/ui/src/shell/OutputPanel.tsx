import { useEffect, useMemo, useRef, useState } from 'react'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import { ProblemsPanel } from '../diagnostics/ProblemsPanel'
import { RefactoringPanel, type RefactoringState } from './RefactoringPanel'
import type { UsageDto } from '../wire/types'
import { ScanServicesPanel } from '../diagnostics/ScanServicesPanel'
import type { Problem } from '../problems/problemStore'

// Bottom tool window (manual chapter 7, screenshot 082). Like the original, a vertical button bar
// sits left of the console (start, stop, exit, clear cache) - these four act on a server instance,
// which Vendira cannot start yet, so they stay dimmed. Added on top: clear log, copy, wrap, a
// text/level filter and automatic scrolling. Problems takes over the validation findings.

export type OutputMainTab = 'output' | 'scanservices' | 'search' | 'notifications' | 'refactoring' | 'problems'
export type OutputSubTab = 'database' | 'build' | 'default' | 'nodejs'

export const OUTPUT_MAIN_TABS: { id: OutputMainTab; label: string }[] = [
  { id: 'output', label: 'Output' },
  { id: 'scanservices', label: 'Scan Services' },
  { id: 'search', label: 'Search Results' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'refactoring', label: 'Refactoring' },
  { id: 'problems', label: 'Problems' },
]

export const OUTPUT_SUB_TABS: { id: OutputSubTab; label: string }[] = [
  { id: 'database', label: 'Database' },
  { id: 'build', label: 'Build' },
  { id: 'default', label: 'Default' },
  { id: 'nodejs', label: 'NodeJS' },
]

export interface OutputLine {
  text: string
  level: 'info' | 'warn' | 'error' | 'success'
}

export function OutputTabs({
  active,
  activeSub,
  onSelect,
  problemCount,
}: {
  active: OutputMainTab
  activeSub: OutputSubTab
  onSelect: (tab: OutputMainTab) => void
  problemCount: number
}) {
  return (
    <div className="forge-panel-tabs" role="tablist" aria-label="Output windows">
      {OUTPUT_MAIN_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`forge-panel-tab${active === t.id ? ' is-active' : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {t.id === 'output' && active === 'output' ? `Output - ${OUTPUT_SUB_TABS.find((x) => x.id === activeSub)!.label}` : t.label}
          {t.id === 'problems' && problemCount > 0 ? (
            <span className="forge-badge" aria-label={`${problemCount} errors`}>
              {problemCount}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

const NOT_AVAILABLE_SERVER = 'Needs a running server instance - Vendira Designer cannot start one yet'

function SideButton({ label, title, disabled, pressed, onClick, children }: { label: string; title: string; disabled?: boolean; pressed?: boolean; onClick?: () => void; children: string }) {
  return (
    <button type="button" className="forge-output-btn" aria-label={label} title={title} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

export function OutputBody({
  active,
  sub,
  onSelectSub,
  logs,
  problems,
  scanning,
  onOpenProblem,
  onClear,
  onRefreshScan,
  refactoring,
  onOpenUsage,
  onDoRefactoring,
  onCloseRefactoring,
}: {
  active: OutputMainTab
  sub: OutputSubTab
  onSelectSub: (tab: OutputSubTab) => void
  logs: Record<OutputSubTab, OutputLine[]>
  problems: Problem[]
  scanning: boolean
  onOpenProblem: (p: Problem) => void
  onClear: (sub: OutputSubTab) => void
  onRefreshScan: () => void
  refactoring: RefactoringState | null
  onOpenUsage: (u: UsageDto) => void
  onDoRefactoring: () => void
  onCloseRefactoring: () => void
}) {
  const [filter, setFilter] = useState('')
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all')
  const [wrap, setWrap] = useState(false)
  const [follow, setFollow] = useState(true)
  const [notice, setNotice] = useState('')
  const [logMenu, setLogMenu] = useState<{ x: number; y: number; selection: string } | null>(null)
  const logRef = useRef<HTMLPreElement | null>(null)
  const lines = logs[sub]

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return lines.filter((l) => {
      if (level === 'error' && l.level !== 'error') return false
      if (level === 'warn' && l.level !== 'error' && l.level !== 'warn') return false
      return !needle || l.text.toLowerCase().includes(needle)
    })
  }, [lines, filter, level])

  useEffect(() => {
    const el = logRef.current
    if (follow && el) el.scrollTop = el.scrollHeight
  }, [shown, follow, sub, active])

  if (active === 'problems') {
    return (
      <div className="forge-output-scroll" role="tabpanel" aria-label="Problems">
        <ProblemsPanel problems={problems} scanning={scanning} onOpen={onOpenProblem} />
      </div>
    )
  }
  if (active === 'refactoring') {
    return (
      <div className="forge-output-scroll">
        <RefactoringPanel state={refactoring} onOpenUsage={onOpenUsage} onDo={onDoRefactoring} onClose={onCloseRefactoring} />
      </div>
    )
  }
  if (active === 'scanservices') {
    return (
      <div className="forge-output-scroll" role="tabpanel" aria-label="Scan Services">
        <ScanServicesPanel problems={problems} scanning={scanning} onRefresh={onRefreshScan} onOpen={onOpenProblem} />
      </div>
    )
  }
  if (active !== 'output') {
    return (
      <div className="forge-panel-empty" role="tabpanel" aria-label={OUTPUT_MAIN_TABS.find((t) => t.id === active)!.label}>
        {active === 'notifications' ? <em>Select a notification to see details</em> : 'Not yet available'}
      </div>
    )
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(shown.map((l) => l.text).join('\n'))
      setNotice('Copied to the clipboard.')
    } catch {
      setNotice('The clipboard is not available.')
    }
  }

  return (
    <div className="forge-output">
      <div className="forge-output-subtabs" role="tablist" aria-label="Output sources">
        {OUTPUT_SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={sub === t.id}
            className={`forge-output-subtab${sub === t.id ? ' is-active' : ''}`}
            onClick={() => onSelectSub(t.id)}
          >
            {t.label}
            {logs[t.id].length > 0 ? <span className="forge-output-count">{logs[t.id].length}</span> : null}
          </button>
        ))}
        <span className="forge-output-filter">
          <select aria-label="Show lines" value={level} onChange={(e) => setLevel(e.target.value as 'all' | 'warn' | 'error')}>
            <option value="all">All</option>
            <option value="warn">Warnings and errors</option>
            <option value="error">Errors only</option>
          </select>
          <input type="text" aria-label="Filter output" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </span>
      </div>
      <div className="forge-output-main">
        <div className="forge-output-bar" role="toolbar" aria-label="Output actions" aria-orientation="vertical">
          <SideButton label="Start" title={`start - ${NOT_AVAILABLE_SERVER}`} disabled>
            ▶
          </SideButton>
          <SideButton label="Stop" title={`stop - ${NOT_AVAILABLE_SERVER}`} disabled>
            ■
          </SideButton>
          <SideButton label="Exit" title={`exit - ${NOT_AVAILABLE_SERVER}`} disabled>
            ✖
          </SideButton>
          <SideButton label="Clear cache" title={`clear cache - ${NOT_AVAILABLE_SERVER}`} disabled>
            🗑
          </SideButton>
          <span className="forge-output-bar-sep" aria-hidden="true" />
          <SideButton label="Clear log" title="Clear this log" onClick={() => onClear(sub)}>
            ⌫
          </SideButton>
          <SideButton label="Copy log" title="Copy the shown lines" onClick={() => void copyAll()}>
            ⧉
          </SideButton>
          <SideButton label="Wrap lines" title="Wrap long lines" pressed={wrap} onClick={() => setWrap((v) => !v)}>
            ↩
          </SideButton>
          <SideButton label="Follow output" title="Scroll to new lines automatically" pressed={follow} onClick={() => setFollow((v) => !v)}>
            ⤓
          </SideButton>
        </div>
        <pre
          ref={logRef}
          className={`forge-output-log${wrap ? ' is-wrapped' : ''}`}
          role="tabpanel"
          aria-label={`${OUTPUT_SUB_TABS.find((t) => t.id === sub)!.label} output`}
          onContextMenu={(e) => {
            e.preventDefault()
            setLogMenu({ x: e.clientX, y: e.clientY, selection: window.getSelection()?.toString() ?? '' })
          }}
          onScroll={(e) => {
            const el = e.currentTarget
            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            setFollow((prev) => (prev === atEnd ? prev : atEnd))
          }}
        >
          {shown.map((l, i) => (
            <div key={i} className={`forge-log-${l.level}`}>
              {l.text}
            </div>
          ))}
          {shown.length === 0 && lines.length > 0 ? <div className="forge-field-hint">No lines match the filter.</div> : null}
        </pre>
      </div>
      {logMenu ? (
        <TreeContextMenu
          entries={[
            { id: 'copy', label: 'Copy', enabled: logMenu.selection !== '', hint: 'Select text in the log first' },
            { id: 'copyAll', label: 'Copy All Shown Lines', enabled: shown.length > 0, hint: 'The log is empty' },
            { id: 'sep', label: '', enabled: false, separator: true },
            { id: 'wrap', label: wrap ? 'Do Not Wrap Lines' : 'Wrap Lines', enabled: true },
            { id: 'clear', label: 'Clear Log', enabled: lines.length > 0, hint: 'The log is empty' },
          ]}
          x={logMenu.x}
          y={logMenu.y}
          onPick={(id) => {
            if (id === 'copy') void navigator.clipboard?.writeText(logMenu.selection)
            else if (id === 'copyAll') void copyAll()
            else if (id === 'wrap') setWrap((v) => !v)
            else if (id === 'clear') onClear(sub)
          }}
          onClose={() => setLogMenu(null)}
        />
      ) : null}
      {notice ? (
        <div className="forge-field-hint forge-output-notice" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  )
}
