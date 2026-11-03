import { useMemo, useState } from 'react'
import type { TunnelRowDto } from '../wire/types'

// Tunnel manager view: the targets of a tunnel config grouped by service (the first part of the
// host name), the four everyday services on top (database, manager, Solr, file browser), the
// rest behind "Other services". Every target has its own Connect / Disconnect.

export const STANDARD_SERVICES: [string, number][] = [
  ['adito-db', 3306],
  ['adito-manager', 8042],
  ['adito-solr', 8983],
  ['filebrowser', 8080],
]
const BROWSER_PORTS = [80, 8080, 8042, 9000, 8443, 443]

export const serviceOf = (row: Pick<TunnelRowDto, 'target_host'>): string => row.target_host.split('.')[0]
export const isStandardTarget = (row: TunnelRowDto): boolean => STANDARD_SERVICES.some(([s, p]) => serviceOf(row) === s && row.target_port === p)
const key = (row: Pick<TunnelRowDto, 'target_host' | 'target_port'>) => `${row.target_host.toLowerCase()}:${row.target_port}`

export type PortState = 'idle' | 'busy' | 'up' | 'error'

export interface TunnelPortsProps {
  rows: TunnelRowDto[]
  stateOf: (row: TunnelRowDto) => PortState
  localPorts: Map<string, number>
  errors: Record<string, string>
  onConnect: (rows: TunnelRowDto[]) => void
  onDisconnect: (rows: TunnelRowDto[]) => void
  onCopy: (text: string) => void
  onBrowser: (url: string) => void
  /** Smaller paddings for the popover next to a system. */
  compact?: boolean
}

function PortRow({ row, state, port, error, p }: { row: TunnelRowDto; state: PortState; port: number | undefined; error?: string; p: TunnelPortsProps }) {
  const address = port ? `127.0.0.1:${port}` : ''
  return (
    <div className={`tp-port${state === 'up' ? ' is-up' : ''}${state === 'error' ? ' is-error' : ''}`} data-state={state}>
      <span className="tp-port-no">{row.target_port}</span>
      <span className="tp-port-addr" title={error ?? row.target_host}>
        {state === 'up' && address ? <code>{address}</code> : state === 'busy' ? <span className="tp-hint">connecting…</span> : state === 'error' ? <span className="tp-error">{error ?? 'failed'}</span> : <span className="tp-hint">disconnected</span>}
      </span>
      <span className="tp-grow" />
      {state === 'up' ? (
        <>
          <button type="button" className="tp-btn" onClick={() => p.onCopy(address)}>
            copy
          </button>
          {BROWSER_PORTS.includes(row.target_port) && address ? (
            <button type="button" className="tp-btn" onClick={() => p.onBrowser(`http://${address}`)}>
              in browser
            </button>
          ) : null}
          <button type="button" className="tp-btn" onClick={() => p.onDisconnect([row])}>
            Disconnect
          </button>
        </>
      ) : (
        <button type="button" className="tp-btn is-primary" disabled={state === 'busy'} onClick={() => p.onConnect([row])}>
          {state === 'busy' ? 'Connecting…' : 'Connect'}
        </button>
      )}
    </div>
  )
}

function ServiceBlock({ service, rows, p }: { service: string; rows: TunnelRowDto[]; p: TunnelPortsProps }) {
  const up = rows.filter((r) => p.stateOf(r) === 'up').length
  return (
    <div className="tp-service" aria-label={service}>
      <div className="tp-service-head">
        <strong>{service}</strong>
        <span className="tp-target" title={rows[0].target_host}>
          {rows[0].target_host.split('.').slice(1).join('.')}
        </span>
        <span className={`tp-count${up === rows.length ? ' is-good' : ''}`}>
          {up}/{rows.length} connected
        </span>
        <span className="tp-grow" />
        {rows.length > 1 ? (
          <>
            <button type="button" className="tp-btn" disabled={up === rows.length} onClick={() => p.onConnect(rows.filter((r) => p.stateOf(r) !== 'up'))}>
              connect all
            </button>
            <button type="button" className="tp-btn" disabled={up === 0} onClick={() => p.onDisconnect(rows.filter((r) => p.stateOf(r) === 'up'))}>
              disconnect all
            </button>
          </>
        ) : null}
      </div>
      {rows.map((r) => (
        <PortRow key={key(r)} row={r} state={p.stateOf(r)} port={p.localPorts.get(key(r))} error={p.errors[key(r)]} p={p} />
      ))}
    </div>
  )
}

export function TunnelPorts(p: TunnelPortsProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [filter, setFilter] = useState('')

  const { standard, others, otherCount, standardRows } = useMemo(() => {
    const byService = new Map<string, TunnelRowDto[]>()
    for (const r of p.rows) {
      const s = serviceOf(r)
      byService.set(s, [...(byService.get(s) ?? []), r])
    }
    for (const list of byService.values()) list.sort((a, b) => a.target_port - b.target_port)
    const standard = STANDARD_SERVICES.map(([s, port]) => [s, (byService.get(s) ?? []).filter((r) => r.target_port === port)] as [string, TunnelRowDto[]]).filter(([, l]) => l.length)
    const needle = filter.trim().toLowerCase()
    const others = [...byService.entries()]
      .map(([s, l]) => [s, l.filter((r) => !isStandardTarget(r))] as [string, TunnelRowDto[]])
      .filter(([s, l]) => l.length && (!needle || s.toLowerCase().includes(needle) || l.some((r) => String(r.target_port).includes(needle))))
      .sort(([a], [b]) => a.localeCompare(b))
    return { standard, others, otherCount: others.reduce((n, [, l]) => n + l.length, 0), standardRows: standard.flatMap(([, l]) => l) }
  }, [p.rows, filter])

  const upRows = p.rows.filter((r) => p.stateOf(r) === 'up')
  const standardUp = standardRows.length > 0 && standardRows.every((r) => p.stateOf(r) === 'up')
  const open = moreOpen || filter.trim() !== ''

  return (
    <section className={`tp${p.compact ? ' is-compact' : ''}`} aria-label="Ports">
      <div className="tp-toolbar">
        <strong>Ports</strong>
        <span className="tp-hint">every service with its own local address</span>
        <span className="tp-grow" />
        <button type="button" className={`tp-btn${standardUp ? '' : ' is-primary'}`} disabled={standardUp || standardRows.length === 0} title="Database, manager, Solr and file browser" onClick={() => p.onConnect(standardRows.filter((r) => p.stateOf(r) !== 'up'))}>
          Connect standard ({standardRows.length})
        </button>
        <button type="button" className="tp-btn" title="Every target of the tunnel config" disabled={upRows.length === p.rows.length} onClick={() => p.onConnect(p.rows.filter((r) => p.stateOf(r) !== 'up'))}>
          Connect all ({p.rows.length})
        </button>
        <button type="button" className="tp-btn" disabled={upRows.length === 0} onClick={() => p.onDisconnect(upRows)}>
          Disconnect all
        </button>
      </div>
      {p.rows.length > 0 ? (
        <div className="tp-info" aria-label="Tunnel details">
          <span>
            Tunnel host: <b>{[...new Set(p.rows.map((r) => `${r.tunnel_host}:${r.tunnel_port}`))].join(', ')}</b>
          </span>
          <span>
            User: <b>{[...new Set(p.rows.map((r) => r.user))].join(', ')}</b>
          </span>
          <span>
            Target network: <b>{[...new Set(p.rows.map((r) => r.target_host.split('.').slice(1).join('.')))].join(', ')}</b>
          </span>
          <span>
            Targets: <b>{p.rows.length}</b> in <b>{new Set(p.rows.map(serviceOf)).size}</b> services, <b>{upRows.length}</b> connected
          </span>
        </div>
      ) : null}
      <div className="tp-label">Standard</div>
      {standard.map(([s, l]) => (
        <ServiceBlock key={s} service={s} rows={l} p={p} />
      ))}
      {standard.length === 0 ? <div className="tp-hint tp-pad">This tunnel config has none of the standard services.</div> : null}
      {otherCount > 0 || filter ? (
        <>
          <div className="tp-more" role="button" tabIndex={0} aria-expanded={open} onClick={() => setMoreOpen((v) => !v)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setMoreOpen((v) => !v)}>
            <span className="tp-chev">{open ? '▼' : '▶'}</span> Other services <span className="tp-hint">{otherCount} targets</span>
            <span className="tp-grow" />
            {open ? <input type="search" placeholder="Service or port…" aria-label="Filter services" value={filter} onClick={(e) => e.stopPropagation()} onChange={(e) => setFilter(e.target.value)} /> : null}
          </div>
          {open ? others.map(([s, l]) => <ServiceBlock key={s} service={s} rows={l} p={p} />) : null}
          {open && others.length === 0 ? <div className="tp-hint tp-pad">Nothing matches the filter.</div> : null}
        </>
      ) : null}
    </section>
  )
}
