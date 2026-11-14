import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createMockForgeApi } from '../test/mockApi'
import { LoopbackSetup } from './LoopbackSetup'

describe('LoopbackSetup', () => {
  it('offers the set-up and shows the result', async () => {
    render(<LoopbackSetup api={createMockForgeApi({ projectTree: [], documents: {} })} />)
    await userEvent.click(await screen.findByRole('button', { name: /Set up/ }))
    expect(await screen.findByText(/Each service gets its own address/)).toBeInTheDocument()
  })
})
