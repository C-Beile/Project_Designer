import { useMemo, useState, type ReactNode } from 'react'
import type { TunnelRowDto } from '../wire/types'
import { Button, Input } from '../core/ui/controls'
import type { MenuEntry } from '../tree/contextMenu'
import { TreeContextMenu } from '../tree/TreeContextMenu'

// Tunnel manager view (compact, like the AditoHub): three tabs (Connected, Pinned, Extended), one thin
// row per target. Extended is the start tab and groups the services (ADITO, PLUGIN, OTHER). A pin is
// "service:port" and holds for every project; pins of targets this tunnel config does not have are ignored.

const BROWSER_PORTS = [80, 8080, 8042, 9000, 8443, 443]

export const serviceOf = (row: Pick<TunnelRowDto, 'target_host'>): string => row.target_host.split('.')[0].toLowerCase()
/** Pin key: service name and port, so a pin works in every environment (the domain differs per system). */
export const pinKey = (row: Pick<TunnelRowDto, 'target_host' | 'target_port'>): string => `${serviceOf(row)}:${row.target_port}`
const key = (row: Pick<TunnelRowDto, 'target_host' | 'target_port'>) => `${row.target_host.toLowerCase()}:${row.target_port}`

export type PortState = 'idle' | 'busy' | 'up' | 'error'
type Tab = 'connected' | 'pinned' | 'extended'

export function categoryOf(service: string): 'ADITO' | 'PLUGIN' | 'OTHER' {
  if (service.startsWith('adito')) return 'ADITO'
  if (service.startsWith('plugin')) return 'PLUGIN'
  return 'OTHER'
}
const CATEGORIES = ['ADITO', 'PLUGIN', 'OTHER'] as const

export interface TunnelPortsProps {
  rows: TunnelRowDto[]
  stateOf: (row: TunnelRowDto) => PortState
  /** Lokale Adresse je Ziel, `host:port`. */
  localAddrs: Map<string, string>
  /** Ziele, deren Tunnel ein anderes Programm geöffnet hat (Wert: Name, etwa `hub`). */
  foreignOwners?: Map<string, string>
  errors: Record<string, string>
  /** Gemerkte Ziele (`service:port`), für alle Projekte. */
  pinned?: Set<string>
  onTogglePin?: (row: TunnelRowDto) => void
  onConnect: (rows: TunnelRowDto[]) => void
  onDisconnect: (rows: TunnelRowDto[]) => void
  onCopy: (text: string) => void
  onBrowser: (url: string) => void
  /** Smaller paddings for the popover next to a system. */
  compact?: boolean
}

const PATHS: Record<string, string> = {
  copy: 'M8 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  browser: 'M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6 M11 13l9-9 M15 4h5v5',
  plug: 'M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054z M4 20l3.5 -3.5 M15 4l-3.5 3.5 M20 9l-3.5 3.5',
  plugOff: 'M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054z M4 20l3.5 -3.5 M15 4l-3.5 3.5 M20 9l-3.5 3.5 M3 3l18 18',
  pin: 'M15 4.5l-4 4-4 1.5-1.5 1.5 7 7 1.5-1.5 1.5-4 4-4 M9 15l-4.5 4.5 M14.5 4l5.5 5.5',
  right: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
  search: 'M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-6-6',
}

function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="tpx-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

function IconButton({ icon, label, onClick, active, disabled, tone }: { icon: keyof typeof PATHS; label: string; onClick: () => void; active?: boolean; disabled?: boolean; tone?: 'connect' | 'disconnect' }) {
  return (
    <Button variant="bare" className={`tpx-ib${active ? ' is-active' : ''}${tone ? ` is-${tone}` : ''}`} aria-label={label} title={label} isDisabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </Button>
  )
}

type OnMenu = (row: TunnelRowDto, x: number, y: number) => void

function PortRow({ row, label, p, onMenu }: { row: TunnelRowDto; label: string; p: TunnelPortsProps; onMenu: OnMenu }) {
  const k = key(row)
  const state = p.stateOf(row)
  const foreign = p.foreignOwners?.get(k)
  const address = p.localAddrs.get(k) ?? ''
  const ip = address.includes(':') ? address.slice(0, address.lastIndexOf(':')) : address
  const isPinned = p.pinned?.has(pinKey(row)) ?? false
  const error = p.errors[k]
  return (
    <div className={`tpx-row${state === 'up' ? ' is-up' : ''}${state === 'error' ? ' is-error' : ''}`} data-state={state} aria-label={`${label} ${row.target_port}`} onDoubleClick={() => state !== 'up' && state !== 'busy' && p.onConnect([row])} onContextMenu={(e) => { e.preventDefault(); onMenu(row, e.clientX, e.clientY) }}>
      <span className="tpx-dot" title={error ?? state} />
      <span className={`tpx-name${state === 'up' ? '' : ' is-off'}`} title={row.target_host}>
        {label}
        {foreign ? <span className="tpx-own" title={`Tunnel opened by ${foreign === 'hub' ? 'AditoHub' : foreign}`}>{foreign === 'hub' ? 'Hub' : foreign}</span> : null}
      </span>
      <span className="tpx-mono">{state === 'up' && ip ? ip : state === 'busy' ? 'connecting…' : state === 'error' ? <span className="tpx-error" title={error}>failed</span> : '–'}</span>
      <span className="tpx-mono">{row.target_port}</span>
      <span className={`tpx-acts${isPinned ? ' has-pin' : ''}`}>
        <span className="tpx-more">
          {state === 'up' && BROWSER_PORTS.includes(row.target_port) && address ? <IconButton icon="browser" label="Open in browser" onClick={() => p.onBrowser(`http://${address}`)} /> : null}
          {state === 'up' && address ? <IconButton icon="copy" label="Copy address" onClick={() => p.onCopy(address)} /> : null}
          {p.onTogglePin ? <IconButton icon="pin" label={isPinned ? 'Unpin' : 'Pin'} active={isPinned} onClick={() => p.onTogglePin?.(row)} /> : null}
        </span>
        {state === 'up' ? <IconButton icon="plugOff" tone="disconnect" label={foreign ? `Ask ${foreign === 'hub' ? 'AditoHub' : foreign} to disconnect` : 'Disconnect'} onClick={() => p.onDisconnect([row])} /> : <IconButton icon="plug" tone="connect" label="Connect" disabled={state === 'busy'} onClick={() => p.onConnect([row])} />}
      </span>
    </div>
  )
}

/** A service with several ports: one header row, the ports below it. */
function ServiceRows({ service, rows, p, onMenu }: { service: string; rows: TunnelRowDto[]; p: TunnelPortsProps; onMenu: OnMenu }) {
  const [open, setOpen] = useState(false)
  if (rows.length === 1) return <PortRow row={rows[0]} label={service} p={p} onMenu={onMenu} />
  const up = rows.filter((r) => p.stateOf(r) === 'up')
  return (
    <>
      <div className="tpx-row tpx-service" data-state={up.length > 0 ? 'up' : 'idle'}>
        <span className="tpx-dot" />
        <span className={`tpx-name${up.length ? '' : ' is-off'}`}>
          <Button variant="bare" className="tpx-chev" aria-expanded={open} aria-label={`${service} ports`} onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? 'down' : 'right'} />
          </Button>
          {service}
        </span>
        <span className="tpx-mono" />
        <span className="tpx-mono">{up.length > 0 ? `${up.length} of ${rows.length}` : `${rows.length} ports`}</span>
        <span className="tpx-acts">
          {up.length < rows.length ? <IconButton icon="plug" tone="connect" label="Connect all ports" onClick={() => p.onConnect(rows.filter((r) => p.stateOf(r) !== 'up'))} /> : null}
          {up.length > 0 ? <IconButton icon="plugOff" tone="disconnect" label="Disconnect all ports" onClick={() => p.onDisconnect(up.filter((r) => !p.foreignOwners?.has(key(r))))} /> : null}
        </span>
      </div>
      {open ? rows.map((r) => <div className="tpx-sub" key={key(r)}><PortRow row={r} label={`Port ${r.target_port}`} p={p} onMenu={onMenu} /></div>) : null}
    </>
  )
}

function groupByService(rows: TunnelRowDto[]): [string, TunnelRowDto[]][] {
  const map = new Map<string, TunnelRowDto[]>()
  for (const r of rows) map.set(serviceOf(r), [...(map.get(serviceOf(r)) ?? []), r])
  for (const list of map.values()) list.sort((a, b) => a.target_port - b.target_port)
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="tpx-empty">{children}</div>
}

export function TunnelPorts(p: TunnelPortsProps) {
  const [tab, setTab] = useState<Tab>('extended')
  const [filter, setFilter] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [rowMenu, setRowMenu] = useState<{ row: TunnelRowDto; x: number; y: number } | null>(null)
  const openMenu: OnMenu = (row, x, y) => setRowMenu({ row, x, y })
  const [closed, setClosed] = useState<Set<string>>(new Set(['PLUGIN', 'OTHER']))

  const needle = filter.trim().toLowerCase()
  const matches = (r: TunnelRowDto) => !needle || serviceOf(r).includes(needle) || String(r.target_port).includes(needle)

  const model = useMemo(() => {
    const visible = p.rows.filter(matches)
    return {
      connected: visible.filter((r) => p.stateOf(r) === 'up'),
      pinned: visible.filter((r) => p.pinned?.has(pinKey(r))),
      extended: groupByService(visible),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rows, p.stateOf, p.pinned, needle])

  const all = p.rows
  const upRows = all.filter((r) => p.stateOf(r) === 'up')
  const pinnedRows = all.filter((r) => p.pinned?.has(pinKey(r)))
  const count = { connected: upRows.length, pinned: pinnedRows.length, extended: all.length }
  const hosts = [...new Set(all.map((r) => `${r.tunnel_host}:${r.tunnel_port}`))].join(', ')
  const users = [...new Set(all.map((r) => r.user))].join(', ')

  const run = (fn: () => void) => {
    setMenuOpen(false)
    fn()
  }

  return (
    <section className={`tpx${p.compact ? ' is-compact' : ''}`} aria-label="Ports">
      <div className="tpx-bar">
        <span className="tpx-meta" title={`${hosts} · ${users}`}>
          {hosts} · {users} · <b>{upRows.length}</b> of {all.length} up
        </span>
        <span className="tpx-grow" />
        <div className="tpx-menu">
          <IconButton icon="dots" label="More" active={menuOpen} onClick={() => setMenuOpen((v) => !v)} />
          {menuOpen ? (
            <div className="tpx-menu-list" role="menu">
              {pinnedRows.some((r) => p.stateOf(r) !== 'up') ? (
                <Button variant="bare" role="menuitem" onClick={() => run(() => p.onConnect(pinnedRows.filter((r) => p.stateOf(r) !== 'up')))}>
                  Connect pinned ({pinnedRows.filter((r) => p.stateOf(r) !== 'up').length})
                </Button>
              ) : null}
              {upRows.length < all.length ? (
                <Button variant="bare" role="menuitem" onClick={() => run(() => p.onConnect(all.filter((r) => p.stateOf(r) !== 'up')))}>
                  Connect all ({all.length - upRows.length})
                </Button>
              ) : null}
              {upRows.length > 0 ? (
                <Button variant="bare" role="menuitem" onClick={() => run(() => p.onDisconnect(upRows.filter((r) => !p.foreignOwners?.has(key(r)))))}>
                  Disconnect all
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="tpx-search">
        <Icon name="search" />
        <Input type="search" placeholder="Filter services and ports" aria-label="Filter services" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="tpx-tabs" role="tablist">
        {(['connected', 'pinned', 'extended'] as Tab[]).map((t) => (
          <Button key={t} variant="bare" role="tab" aria-selected={tab === t} className={`tpx-tab${tab === t ? ' is-on' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)} <span className="tpx-count">{count[t]}</span>
          </Button>
        ))}
      </div>
      <div className="tpx-list" role="tabpanel">
        {tab === 'connected' ? (
          model.connected.length ? model.connected.map((r) => <PortRow key={key(r)} row={r} label={serviceOf(r)} p={p} onMenu={openMenu} />) : <Empty>No tunnel is open.</Empty>
        ) : null}
        {tab === 'pinned' ? (
          model.pinned.length ? model.pinned.map((r) => <PortRow key={key(r)} row={r} label={serviceOf(r)} p={p} onMenu={openMenu} />) : <Empty>Nothing pinned. Pin a service in Extended; pins hold for every project.</Empty>
        ) : null}
        {tab === 'extended'
          ? CATEGORIES.map((c) => {
              const groups = model.extended.filter(([s]) => categoryOf(s) === c)
              if (groups.length === 0) return null
              const isOpen = !closed.has(c) || needle !== ''
              return (
                <div key={c}>
                  <Button variant="bare" className="tpx-group" aria-expanded={isOpen} onClick={() => setClosed((prev) => { const next = new Set(prev); if (next.has(c)) next.delete(c); else next.add(c); return next })}>
                    <Icon name={isOpen ? 'down' : 'right'} />
                    {c} · {groups.length}
                  </Button>
                  {isOpen ? groups.map(([s, l]) => <ServiceRows key={s} service={s} rows={l} p={p} onMenu={openMenu} />) : null}
                </div>
              )
            })
          : null}
        {tab === 'extended' && model.extended.length === 0 ? <Empty>{needle ? 'Nothing matches the filter.' : 'This tunnel config has no targets.'}</Empty> : null}
      </div>
      {rowMenu ? <RowMenu menu={rowMenu} p={p} onClose={() => setRowMenu(null)} /> : null}
    </section>
  )
}

function RowMenu({ menu, p, onClose }: { menu: { row: TunnelRowDto; x: number; y: number }; p: TunnelPortsProps; onClose: () => void }) {
  const { row } = menu
  const k = key(row)
  const state = p.stateOf(row)
  const up = state === 'up'
  const foreign = p.foreignOwners?.has(k) ?? false
  const address = p.localAddrs.get(k) ?? ''
  const pinned = p.pinned?.has(pinKey(row)) ?? false
  // Connect und Disconnect erscheinen je nach Zustand, es steht immer nur der passende Eintrag da.
  const entries: MenuEntry[] = [
    ...(up ? [{ id: 'disconnect', label: foreign ? 'Disconnect (asks the owner)' : 'Disconnect', enabled: true, icon: <span className="tpx-tone-disconnect"><Icon name="plugOff" /></span> }] : [{ id: 'connect', label: 'Connect', enabled: state !== 'busy', hint: 'A connection attempt is running', icon: <span className="tpx-tone-connect"><Icon name="plug" /></span> }]),
    { id: 'sep0', label: '', enabled: false, separator: true },
    { id: 'copy', label: 'Copy address', enabled: up && !!address, hint: 'The tunnel is not open', icon: <Icon name="copy" /> },
    { id: 'browser', label: 'Open in browser', enabled: up && !!address && BROWSER_PORTS.includes(row.target_port), hint: 'Not a web port or not open', icon: <Icon name="browser" /> },
    { id: 'sep1', label: '', enabled: false, separator: true },
    { id: 'pin', label: pinned ? 'Unpin' : 'Pin', enabled: !!p.onTogglePin, icon: <Icon name="pin" /> },
  ]
  const pick = (id: string) => {
    if (id === 'connect') p.onConnect([row])
    else if (id === 'disconnect') p.onDisconnect([row])
    else if (id === 'copy') p.onCopy(address)
    else if (id === 'browser') p.onBrowser(`http://${address}`)
    else if (id === 'pin') p.onTogglePin?.(row)
  }
  return <TreeContextMenu entries={entries} x={menu.x} y={menu.y} onPick={pick} onClose={onClose} />
}
