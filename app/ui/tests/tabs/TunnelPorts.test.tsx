import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TunnelRowDto } from '../../src/wire/types'
import { TunnelPorts, pinKey, type TunnelPortsProps } from '../../src/tabs/TunnelPorts'

const row = { target_host: 'adito-db.dev.svc.cluster.local', target_port: 3306 } as TunnelRowDto
const zoo = { target_host: 'adito-zookeeper.dev.svc.cluster.local', target_port: 2181 } as TunnelRowDto
const KEY = 'adito-db.dev.svc.cluster.local:3306'

function props(extra: Partial<TunnelPortsProps>): TunnelPortsProps {
  return { rows: [row], stateOf: () => 'up', localAddrs: new Map([[KEY, '127.0.2.1:3306']]), errors: {}, onConnect: vi.fn(), onDisconnect: vi.fn(), onCopy: vi.fn(), onBrowser: vi.fn(), ...extra }
}

describe('TunnelPorts', () => {
  it('starts on Extended and shows the address and a Disconnect button for an own tunnel', () => {
    render(<TunnelPorts {...props({})} />)
    expect(screen.getByRole('tab', { name: /Extended/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('127.0.2.1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    expect(screen.queryByText('Hub')).toBeNull()
  })

  it('marks a tunnel of the AditoHub in every tab and asks the Hub to disconnect it', () => {
    render(<TunnelPorts {...props({ foreignOwners: new Map([[KEY, 'hub']]), pinned: new Set([pinKey(row)]) })} />)
    for (const tab of [/Extended/, /Connected/, /Pinned/]) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      expect(screen.getByText('Hub')).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ask AditoHub to disconnect' })).toBeInTheDocument()
  })

  it('Pinned lists only pinned targets that this config has and ignores unknown pins', () => {
    render(<TunnelPorts {...props({ rows: [row, zoo], stateOf: (r) => (r === row ? 'up' : 'idle'), pinned: new Set(['adito-zookeeper:2181', 'unknown:1']) })} />)
    fireEvent.click(screen.getByRole('tab', { name: /Pinned/ }))
    expect(screen.getByRole('tab', { name: /Pinned/ })).toHaveTextContent('1')
    expect(screen.getByText('adito-zookeeper')).toBeInTheDocument()
    expect(screen.queryByText('adito-db')).toBeNull()
    expect(screen.queryByText('unknown')).toBeNull()
  })

  it('the pin button reports the row and Connected lists open tunnels only', () => {
    const onTogglePin = vi.fn()
    render(<TunnelPorts {...props({ rows: [row, zoo], stateOf: (r) => (r === row ? 'up' : 'idle'), onTogglePin })} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Pin' })[0])
    expect(onTogglePin).toHaveBeenCalledWith(row)
    fireEvent.click(screen.getByRole('tab', { name: /Connected/ }))
    expect(screen.getByText('adito-db')).toBeInTheDocument()
    expect(screen.queryByText('adito-zookeeper')).toBeNull()
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
