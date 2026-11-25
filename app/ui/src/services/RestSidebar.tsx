import { useEffect, useMemo, useState } from 'react'
import type { WebserviceDto } from '../wire/types'
import { Button, Input } from '../core/ui/controls'
import { agoText, callsOf, isCustom, statusClass, type HistoryEntry, type RestCall } from './restTools'

type KindFilter = 'all' | 'entity' | 'custom'
type SideTab = 'services' | 'history'

const KIND_LABEL: Record<KindFilter, string> = { all: 'All', entity: 'Entity', custom: 'Custom' }

function KindBadge({ ws }: { ws: WebserviceDto }) {
  const custom = isCustom(ws)
  return (
    <span className={`rest-kind k-${custom ? 'custom' : 'entity'}`} title={custom ? 'Custom web service: a process published as REST' : 'Entity web service'}>
      {custom ? 'C' : 'E'}
    </span>
  )
}

function pathOf(url: string): string {
  const m = /^https?:\/\/[^/?#]*(.*)$/i.exec(url)
  return (m ? m[1] : url) || '/'
}

export function RestSidebar({
  services,
  selected,
  call,
  onChoose,
  history,
  onRestore,
  now,
}: {
  services: WebserviceDto[]
  selected: WebserviceDto | null
  call: RestCall | null
  onChoose: (ws: WebserviceDto, c: RestCall) => void
  history: HistoryEntry[]
  onRestore: (entry: HistoryEntry) => void
  now: number
}) {
  const [tab, setTab] = useState<SideTab>('services')
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setOpen(new Set(services.filter((w) => w.module === null).map((w) => w.name)))
  }, [services])

  const matching = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q === '' ? services : services.filter((w) => w.name.toLowerCase().includes(q))
  }, [services, filter])

  const counts = useMemo(() => ({ all: matching.length, entity: matching.filter((w) => !isCustom(w)).length, custom: matching.filter(isCustom).length }), [matching])

  const groups = useMemo(() => {
    const map = new Map<string, WebserviceDto[]>()
    for (const w of matching) {
      if (kind !== 'all' && (kind === 'custom') !== isCustom(w)) continue
      const key = w.module ?? 'Project'
      map.set(key, [...(map.get(key) ?? []), w])
    }
    return [...map.entries()]
  }, [matching, kind])

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }

  return (
    <aside className="rest-side" aria-label="Web services">
      <div className="rest-side-tabs" role="tablist" aria-label="Sidebar">
        <Button variant="bare" role="tab" aria-selected={tab === 'services'} className={`rest-side-tab${tab === 'services' ? ' is-active' : ''}`} onClick={() => setTab('services')}>
          Services <span className="rest-badge">{services.length}</span>
        </Button>
        <Button variant="bare" role="tab" aria-selected={tab === 'history'} className={`rest-side-tab${tab === 'history' ? ' is-active' : ''}`} onClick={() => setTab('history')}>
          History {history.length > 0 ? <span className="rest-badge">{history.length}</span> : null}
        </Button>
      </div>

      {tab === 'services' ? (
        <>
          <Input className="rest-filter" value={filter} placeholder="Filter web services" aria-label="Filter web services" onChange={(e) => setFilter(e.target.value)} />
          <div className="rest-kinds" role="group" aria-label="Kind of web service">
            {(['all', 'entity', 'custom'] as const).map((k) => (
              <Button key={k} variant="bare" className={`rest-kindpick${kind === k ? ' is-on' : ''} k-${k}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]} <span className="rest-kindcount">{counts[k]}</span>
              </Button>
            ))}
          </div>
          <div className="rest-list">
            {groups.length === 0 ? <p className="rest-empty">{services.length === 0 ? 'No web services in this project.' : 'Nothing matches the filter.'}</p> : null}
            {groups.map(([group, list]) => {
              const shut = collapsed.has(group) && filter.trim() === ''
              return (
                <section key={group}>
                  <h4>
                    <Button variant="bare" className="rest-group" aria-expanded={!shut} onClick={() => setCollapsed((cur) => toggle(cur, group))}>
                      <span className="rest-caret">{shut ? '▸' : '▾'}</span>
                      <span className="rest-group-name">{group}</span>
                      <span className="rest-kindcount">{list.length}</span>
                    </Button>
                  </h4>
                  {shut
                    ? null
                    : list.map((ws) => {
                        const calls = callsOf(ws)
                        const isOpen = open.has(ws.name) || filter.trim() !== ''
                        return (
                          <div key={`${group}/${ws.name}`} className={`rest-ws k-${isCustom(ws) ? 'custom' : 'entity'}`}>
                            <Button variant="bare" className={`rest-ws-head${selected?.name === ws.name ? ' is-selected' : ''}`} aria-expanded={isOpen} onClick={() => setOpen((cur) => toggle(cur, ws.name))}>
                              <span className="rest-caret">{isOpen ? '▾' : '▸'}</span>
                              <KindBadge ws={ws} />
                              <span className="rest-ws-name">{ws.name}</span>
                              {!isOpen ? (
                                <span className="rest-mdots" title={ws.methods.join(', ')} aria-hidden="true">
                                  {calls
                                    .map((c) => c.method)
                                    .filter((m, i, all) => all.indexOf(m) === i)
                                    .map((m) => (
                                      <span key={m} className={`rest-mdot m-bg-${m}`} />
                                    ))}
                                </span>
                              ) : null}
                            </Button>
                            {isOpen ? (
                              <>
                                {isCustom(ws) && (ws.accepts || ws.delivers) ? (
                                  <p className="rest-ws-meta">
                                    {ws.accepts ?? '—'} <span aria-hidden="true">→</span> {ws.delivers ?? '—'}
                                  </p>
                                ) : null}
                                {calls.length === 0 ? (
                                  <p className="rest-empty rest-nomethods">No method is allowed.</p>
                                ) : (
                                  calls.map((c) => (
                                    <Button variant="bare" key={c.id} className={`rest-item${call?.id === c.id ? ' is-active' : ''}`} title={`${c.method} ${c.path}`} onClick={() => onChoose(ws, c)}>
                                      <span className={`rest-method m-${c.method}`}>{c.method}</span>
                                      <span className="rest-item-name">{c.label}</span>
                                    </Button>
                                  ))
                                )}
                              </>
                            ) : null}
                          </div>
                        )
                      })}
                </section>
              )
            })}
          </div>
        </>
      ) : (
        <div className="rest-list rest-history">
          {history.length === 0 ? <p className="rest-empty">Calls you send show up here. Click one to load it again.</p> : null}
          {history.map((h) => (
            <Button variant="bare" key={h.id} className="rest-hist" title={h.url} onClick={() => onRestore(h)}>
              <span className={`rest-method m-${h.method}`}>{h.method}</span>
              <span className="rest-hist-main">
                <span className="rest-hist-name">{h.serviceName ?? pathOf(h.url)}</span>
                <span className="rest-hist-sub">{agoText(h.at, now)}{h.elapsedMs !== null ? ` · ${h.elapsedMs} ms` : ''}</span>
              </span>
              {h.status !== null ? <span className={`rest-status s-${statusClass(h.status)} is-small`}>{h.status}</span> : <span className="rest-status s-server is-small">failed</span>}
            </Button>
          ))}
        </div>
      )}
    </aside>
  )
}
