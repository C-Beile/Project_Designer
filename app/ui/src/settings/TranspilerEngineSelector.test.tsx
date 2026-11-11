import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExperimentalEngineWarning, TranspilerEngineSelector } from './TranspilerEngineSelector'
import { DEFAULT_ENGINE, transpileParams, type TranspilerEngineId } from './transpilerEngine'

function Harness() {
  const [engine, setEngine] = useState<TranspilerEngineId>(DEFAULT_ENGINE)
  return (
    <>
      <TranspilerEngineSelector engine={engine} onChange={setEngine} />
      <ExperimentalEngineWarning engine={engine} />
    </>
  )
}

describe('TranspilerEngineSelector', () => {
  it('defaults to the ADITO transpiler, with no warning shown', () => {
    render(<Harness />)
    expect(screen.getByLabelText(/transpiler engine/i)).toHaveValue('official')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers the Dito_Transpiler as a choice and shows no warning for either', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.selectOptions(screen.getByLabelText(/transpiler engine/i), 'experimental')
    expect(screen.getByLabelText(/transpiler engine/i)).toHaveValue('experimental')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports every change to the host, which owns the (never persisted) choice', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TranspilerEngineSelector engine="experimental" onChange={onChange} />)
    await user.selectOptions(screen.getByLabelText(/transpiler engine/i), 'official')
    expect(onChange).toHaveBeenCalledWith('official')
  })
})

describe('transpileParams', () => {
  it('passes the engine and leaves install_dir out when none is configured', () => {
    expect(transpileParams('official', 'full', null)).toEqual({ engine: 'official', mode: 'full' })
    expect(transpileParams('experimental', 'partial', '  ')).toEqual({ engine: 'experimental', mode: 'partial' })
  })

  it('hands on a configured Designer installation as install_dir', () => {
    expect(transpileParams('official', 'full', ' C:/ADITO/designer ')).toEqual({
      engine: 'official',
      mode: 'full',
      install_dir: 'C:/ADITO/designer',
    })
  })
})
