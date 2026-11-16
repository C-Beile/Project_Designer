import { useMemo, useState } from 'react'
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

function stateText(p: TunnelPortsProps, row: TunnelRowDto): { text: string; tone: string } {
  const state = p.stateOf(row)
  const k = key(row)
  if (state === 'up') return { text: p.localAddrs.get(k) ?? 'connected', tone: 'is-up' }
  if (state === 'busy') return { text: 'connecting…', tone: 'is-busy' }
  if (state === 'error') return { text: 'failed', tone: 'is-error' }
  return { text: 'disconnected', tone: '' }
}

/** Eine Zeile: Punkt, Name, Port, Adresse oder Zustand, rechts die Knöpfe. */
function PortLine({ row, label, p, onMenu }: { row: TunnelRowDto; label: string; p: TunnelPortsProps; onMenu: OnMenu }) {
  const k = key(row)
  const state = p.stateOf(row)
  const foreign = p.foreignOwners?.get(k)
  const address = p.localAddrs.get(k) ?? ''
  const isPinned = p.pinned?.has(pinKey(row)) ?? false
  const error = p.errors[k]
  const { text, tone } = stateText(p, row)
  return (
    <div
      className={`tpx-line is-${state}`}
      data-state={state}
      aria-label={`${label} ${row.target_port}`}
      onDoubleClick={() => state !== 'up' && state !== 'busy' && p.onConnect([row])}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(row, e.clientX, e.clientY)
      }}
    >
      <span className="tpx-dot" title={error ?? state} />
      <span className="tpx-line-name" title={row.target_host}>
        {label}
        {foreign ? (
          <span className="tpx-own" title={`Tunnel opened by ${foreign === 'hub' ? 'AditoHub' : foreign}`}>
            {foreign === 'hub' ? 'Hub' : foreign}
          </span>
        ) : null}
      </span>
      <span className="tpx-line-port">{row.target_port}</span>
      <span className={`tpx-line-state ${tone}`} title={error}>
        {text}
      </span>
      <span className="tpx-grow" />
      <span className={`tpx-acts${isPinned ? ' has-pin' : ''}`}>
        <span className="tpx-more">
          {state === 'up' && BROWSER_PORTS.includes(row.target_port) && address ? <IconButton icon="browser" label="Open in browser" onClick={() => p.onBrowser(`http://${address}`)} /> : null}
          {state === 'up' && address ? <IconButton icon="copy" label="Copy address" onClick={() => p.onCopy(address)} /> : null}
          {p.onTogglePin ? <IconButton icon="pin" label={isPinned ? 'Unpin' : 'Pin'} active={isPinned} onClick={() => p.onTogglePin?.(row)} /> : null}
        </span>
        {state === 'up' ? (
          <Button variant="bare" className="tpx-pill is-danger" aria-label={foreign ? `Ask ${foreign === 'hub' ? 'AditoHub' : foreign} to disconnect` : 'Disconnect'} onClick={() => p.onDisconnect([row])}>
            Disconnect
          </Button>
        ) : (
          <Button variant="bare" className="tpx-pill is-primary" aria-label="Connect" isDisabled={state === 'busy'} onClick={() => p.onConnect([row])}>
            Connect
          </Button>
        )}
      </span>
    </div>
  )
}

function groupByService(rows: TunnelRowDto[]): [string, TunnelRowDto[]][] {
  const map = new Map<string, TunnelRowDto[]>()
  for (const r of rows) map.set(serviceOf(r), [...(map.get(serviceOf(r)) ?? []), r])
  for (const list of map.values()) list.sort((a, b) => a.target_port - b.target_port)
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function ServiceGroup({ service, rows, p, onMenu }: { service: string; rows: TunnelRowDto[]; p: TunnelPortsProps; onMenu: OnMenu }) {
  if (rows.length === 1) return <PortLine row={rows[0]} label={service} p={p} onMenu={onMenu} />
  const up = rows.filter((r) => p.stateOf(r) === 'up')
  const mine = up.filter((r) => !p.foreignOwners?.has(key(r)))
  const idle = rows.filter((r) => p.stateOf(r) !== 'up' && p.stateOf(r) !== 'busy')
  return (
    <div className="tpx-group-block">
      <div className="tpx-group-head">
        <strong>{service}</strong>
        <span>
          {up.length}/{rows.length} connected
        </span>
        <span className="tpx-grow" />
        {rows.length > 1 ? (
          <>
            <Button variant="bare" className="tpx-pill is-small" isDisabled={idle.length === 0} aria-label={`Connect all ${service}`} onClick={() => p.onConnect(idle)}>
              connect all
            </Button>
            <Button variant="bare" className="tpx-pill is-small" isDisabled={mine.length === 0} aria-label={`Disconnect all ${service}`} onClick={() => p.onDisconnect(mine)}>
              disconnect all
            </Button>
          </>
        ) : null}
      </div>
      {rows.map((r) => (
        <PortLine key={key(r)} row={r} label={`Port ${r.target_port}`} p={p} onMenu={onMenu} />
      ))}
    </div>
  )
}

/** Services, die man fast immer braucht: sie stehen oben als Karten, noch vor den Reitern. Gemerkte Ziele (Pins) kommen zuerst. */
export const KEY_SERVICES = ['adito-db', 'adito-web', 'adito-manager', 'adito-solr']

export function keyPods(rows: TunnelRowDto[], pinned?: Set<string>): TunnelRowDto[] {
  const byService = new Map<string, TunnelRowDto[]>()
  for (const r of rows) byService.set(serviceOf(r), [...(byService.get(serviceOf(r)) ?? []), r])
  const pick = (list: TunnelRowDto[]) => [...list].sort((a, b) => Number(BROWSER_PORTS.includes(b.target_port)) - Number(BROWSER_PORTS.includes(a.target_port)) || a.target_port - b.target_port)[0]
  const pinnedRows = rows.filter((r) => pinned?.has(pinKey(r)))
  const featured = KEY_SERVICES.filter((s) => byService.has(s) && !pinnedRows.some((r) => serviceOf(r) === s)).map((s) => pick(byService.get(s)!))
  return [...pinnedRows, ...featured].slice(0, 6)
}

export function TunnelPorts(p: TunnelPortsProps) {
  const [drawer, setDrawer] = useState(false)
  const [filter, setFilter] = useState('')
  const [rowMenu, setRowMenu] = useState<{ row: TunnelRowDto; x: number; y: number } | null>(null)
  const openMenu: OnMenu = (row, x, y) => setRowMenu({ row, x, y })

  const all = p.rows
  const featured = useMemo(() => keyPods(all, p.pinned), [all, p.pinned])
  const featuredKeys = useMemo(() => new Set(featured.map(key)), [featured])
  const others = useMemo(() => all.filter((r) => !featuredKeys.has(key(r))), [all, featuredKeys])
  const needle = filter.trim().toLowerCase()
  const shown = useMemo(() => groupByService(others.filter((r) => !needle || serviceOf(r).includes(needle) || String(r.target_port).includes(needle))), [others, needle])

  const idle = (list: TunnelRowDto[]) => list.filter((r) => p.stateOf(r) !== 'up' && p.stateOf(r) !== 'busy')
  const upRows = all.filter((r) => p.stateOf(r) === 'up')
  const mineUp = upRows.filter((r) => !p.foreignOwners?.has(key(r)))
  const defaultIdle = idle(featured)
  const allIdle = idle(all)
  const hosts = [...new Set(all.map((r) => `${r.tunnel_host}:${r.tunnel_port}`))].join(', ')
  const users = [...new Set(all.map((r) => r.user))].join(', ')
  const isOpen = drawer || needle !== ''

  return (
    <section className={`tpx${p.compact ? ' is-compact' : ''}`} aria-label="Ports">
      <div className="tpx-bar">
        <span className="tpx-meta" title={`${hosts} · ${users}`}>
          {hosts} · {users} · <b>{upRows.length}</b> of {all.length} up
        </span>
      </div>
      <header className="tpx-default-head">
        <strong>Ports</strong>
        <span className="tpx-default-sub">every service with its own loopback address and its original port</span>
        <span className="tpx-grow" />
        <Button variant="bare" className="tpx-pill is-primary" isDisabled={defaultIdle.length === 0} onClick={() => p.onConnect(defaultIdle)}>
          Connect default ({defaultIdle.length})
        </Button>
        <Button variant="bare" className="tpx-pill" isDisabled={allIdle.length === 0} onClick={() => p.onConnect(allIdle)}>
          Connect all ({allIdle.length})
        </Button>
        <Button variant="bare" className="tpx-pill" isDisabled={mineUp.length === 0} onClick={() => p.onDisconnect(mineUp)}>
          Disconnect all
        </Button>
      </header>
      {featured.length > 0 ? (
        <div className="tpx-default" role="group" aria-label="Key pods">
          {featured.map((r) => (
            <PortLine key={key(r)} row={r} label={serviceOf(r)} p={p} onMenu={openMenu} />
          ))}
        </div>
      ) : null}
      <div className="tpx-drawer">
        <Button variant="bare" className="tpx-drawer-head" aria-expanded={isOpen} onClick={() => setDrawer((v) => !v)}>
          <Icon name={isOpen ? 'down' : 'right'} />
          <span>Other services</span>
          <span className="tpx-count">{others.length} targets</span>
        </Button>
        <div className="tpx-search">
          <Icon name="search" />
          <Input type="search" placeholder="Service or port…" aria-label="Filter services" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      {isOpen ? (
        <div className="tpx-list" role="region" aria-label="Other services">
          {shown.map(([s, l]) => (
            <ServiceGroup key={s} service={s} rows={l} p={p} onMenu={openMenu} />
          ))}
          {shown.length === 0 ? <div className="tpx-empty">{needle ? 'Nothing matches the filter.' : 'No other targets in this tunnel config.'}</div> : null}
        </div>
      ) : null}
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
