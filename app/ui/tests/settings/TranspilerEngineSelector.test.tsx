import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExperimentalEngineWarning, TranspilerEngineSelector } from '../../src/settings/TranspilerEngineSelector'
import { DEFAULT_ENGINE, transpileParams, type TranspilerEngineId } from '../../src/settings/transpilerEngine'
import { choose, selected } from '../support/dropdown'

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
    expect(selected(/transpiler engine/i)).toBe('official')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers the Dito_Transpiler as a choice and shows no warning for either', async () => {
    const user = userEvent.setup({ delay: null })
    render(<Harness />)
    await choose(user, /transpiler engine/i, 'experimental')
    expect(selected(/transpiler engine/i)).toBe('experimental')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports every change to the host, which owns the (never persisted) choice', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup({ delay: null })
    render(<TranspilerEngineSelector engine="experimental" onChange={onChange} />)
    await choose(user, /transpiler engine/i, 'official')
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

describe('transpileParams for the new engine', () => {
  it('asks for dist only from the new engine and only when switched on', () => {
    expect(transpileParams('dito-v2', 'full', null)).toEqual({ engine: 'dito-v2', mode: 'full' })
    expect(transpileParams('dito-v2', 'full', null, true)).toEqual({ engine: 'dito-v2', mode: 'full', write_dist: 'true' })
    expect(transpileParams('official', 'full', null, true)).toEqual({ engine: 'official', mode: 'full' })
  })
})
