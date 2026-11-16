import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TunnelRowDto } from '../../src/wire/types'
import { TunnelPorts, keyPods, pinKey, type TunnelPortsProps } from '../../src/tabs/TunnelPorts'

const row = { target_host: 'adito-db.dev.svc.cluster.local', target_port: 3306 } as TunnelRowDto
const zoo = { target_host: 'adito-zookeeper.dev.svc.cluster.local', target_port: 2181 } as TunnelRowDto
const KEY = 'adito-db.dev.svc.cluster.local:3306'

function props(extra: Partial<TunnelPortsProps>): TunnelPortsProps {
  return { rows: [row], stateOf: () => 'up', localAddrs: new Map([[KEY, '127.0.2.1:3306']]), errors: {}, onConnect: vi.fn(), onDisconnect: vi.fn(), onCopy: vi.fn(), onBrowser: vi.fn(), ...extra }
}

describe('TunnelPorts', () => {
  it('shows a key service with its address and a Disconnect button for an own tunnel', () => {
    render(<TunnelPorts {...props({})} />)
    expect(screen.getByText('127.0.2.1:3306')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    expect(screen.queryByText('Hub')).toBeNull()
  })

  it('marks a tunnel of the AditoHub and asks the Hub to disconnect it', () => {
    render(<TunnelPorts {...props({ foreignOwners: new Map([[KEY, 'hub']]), pinned: new Set([pinKey(row)]) })} />)
    expect(screen.getByText('Hub')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ask AditoHub to disconnect' })).toBeInTheDocument()
  })

  it('pinned targets come first in the default list; unknown pins are ignored', () => {
    render(<TunnelPorts {...props({ rows: [row, zoo], stateOf: () => 'idle', pinned: new Set(['adito-zookeeper:2181', 'unknown:1']) })} />)
    const list = screen.getByRole('group', { name: 'Key pods' })
    expect(list).toHaveTextContent('adito-zookeeper')
    expect(list).toHaveTextContent('adito-db')
    expect(screen.queryByText('unknown')).toBeNull()
  })

  it('the pin button reports the row', () => {
    const onTogglePin = vi.fn()
    render(<TunnelPorts {...props({ rows: [row], stateOf: () => 'idle', onTogglePin })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    expect(onTogglePin).toHaveBeenCalledWith(row)
  })

  it('keeps the other services in a drawer that opens on click and on typing a filter', () => {
    render(<TunnelPorts {...props({ rows: [row, zoo], stateOf: () => 'idle' })} />)
    const head = screen.getByRole('button', { name: /Other services/ })
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(head).toHaveTextContent('1 targets')
    expect(screen.queryByText('adito-zookeeper')).toBeNull()
    fireEvent.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('adito-zookeeper')).toBeInTheDocument()
    fireEvent.click(head)
    expect(screen.queryByText('adito-zookeeper')).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter services'), { target: { value: 'zoo' } })
    expect(screen.getByText('adito-zookeeper')).toBeInTheDocument()
  })

  it('pins work across environments: the key is service and port, not the domain', () => {
    expect(pinKey({ target_host: 'adito-db.a.svc', target_port: 3306 })).toBe(pinKey({ target_host: 'ADITO-DB.b.svc', target_port: 3306 }))
  })

  it('a double click connects an idle target, and the right click menu connects or disconnects', () => {
    const onConnect = vi.fn()
    const onDisconnect = vi.fn()
    const { rerender } = render(<TunnelPorts {...props({ stateOf: () => 'idle', onConnect, onDisconnect })} />)
    fireEvent.doubleClick(screen.getByLabelText('adito-db 3306'))
    expect(onConnect).toHaveBeenCalledWith([row])
    fireEvent.contextMenu(screen.getByLabelText('adito-db 3306'))
    expect(screen.queryByRole('menuitem', { name: 'Disconnect' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connect' }))
    expect(onConnect).toHaveBeenCalledTimes(2)
    rerender(<TunnelPorts {...props({ onConnect, onDisconnect })} />)
    fireEvent.doubleClick(screen.getByLabelText('adito-db 3306'))
    expect(onConnect).toHaveBeenCalledTimes(2)
    fireEvent.contextMenu(screen.getByLabelText('adito-db 3306'))
    expect(screen.queryByRole('menuitem', { name: 'Connect' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }))
    expect(onDisconnect).toHaveBeenCalledWith([row])
  })
})

describe('key pods', () => {
  const at = (host: string, port: number) => ({ target_host: `${host}.t.svc`, target_port: port }) as TunnelRowDto

  it('picks the important services once, preferring the web port, and puts pins first', () => {
    const rows = [at('adito-db', 3306), at('adito-web', 1099), at('adito-web', 8080), at('adito-ignite', 47100), at('adito-solr', 8983)]
    expect(keyPods(rows).map((r) => `${r.target_host.split('.')[0]}:${r.target_port}`)).toEqual(['adito-db:3306', 'adito-web:8080', 'adito-solr:8983'])
    expect(keyPods(rows, new Set(['adito-ignite:47100']))[0].target_host).toBe('adito-ignite.t.svc')
  })

  it('shows only the key services in the default list', () => {
    render(<TunnelPorts {...props({ rows: [row, zoo], stateOf: () => 'idle' })} />)
    expect(screen.getByRole('group', { name: 'Key pods' })).toHaveTextContent('adito-db')
    expect(screen.getByRole('group', { name: 'Key pods' })).not.toHaveTextContent('adito-zookeeper')
  })
})

