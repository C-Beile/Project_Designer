import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TunnelRowDto } from '../wire/types'
import { TunnelPorts, type TunnelPortsProps } from './TunnelPorts'

const row = { target_host: 'adito-db.dev.svc.cluster.local', target_port: 3306 } as TunnelRowDto

function props(extra: Partial<TunnelPortsProps>): TunnelPortsProps {
  return { rows: [row], stateOf: () => 'up', localAddrs: new Map([['adito-db.dev.svc.cluster.local:3306', '127.0.2.1:3306']]), errors: {}, onConnect: vi.fn(), onDisconnect: vi.fn(), onCopy: vi.fn(), onBrowser: vi.fn(), ...extra }
}

describe('TunnelPorts', () => {
  it('shows the address and a Disconnect button for an own tunnel', () => {
    render(<TunnelPorts {...props({})} />)
    expect(screen.getByText('127.0.2.1:3306')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('marks a tunnel of the AditoHub and offers no Disconnect for it', () => {
    render(<TunnelPorts {...props({ foreignOwners: new Map([['adito-db.dev.svc.cluster.local:3306', 'hub']]) })} />)
    expect(screen.getByText(/via AditoHub/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })
})
