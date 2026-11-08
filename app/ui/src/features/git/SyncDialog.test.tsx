import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SyncDialog } from './SyncDialog'
import { createMockForgeApi } from '../test/mockApi'
import type { GitOverview } from '../wire/types'

const git: GitOverview = {
  root: 'C:/p',
  branch: 'main',
  files: [],
  branches: [{ name: 'main', is_current: true }],
  remote_branches: [],
  commits: [
    { hash: 'bbbbbbbb1', author: 'T', date: '2026-11-03T10:00:00+01:00', subject: 'Second' },
    { hash: 'aaaaaaaa1', author: 'T', date: '2026-11-03T09:00:00+01:00', subject: 'First' },
  ],
}

describe('SyncDialog', () => {
  it('push: lists local commits and pushes up to the newest ticked one', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    const user = userEvent.setup()
    render(<SyncDialog api={api} projectRoot="C:/p" mode="push" onClose={() => {}} onDone={() => {}} />)
    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes.length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Push' }))
    await waitFor(() => expect(api.gitCalls.some((c: string) => c.startsWith('pushTo:'))).toBe(true))
  })

  it('pull: says when there is nothing to pull', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<SyncDialog api={api} projectRoot="C:/p" mode="pull" onClose={() => {}} onDone={() => {}} />)
    expect(await screen.findByText(/Nothing to pull/)).toBeInTheDocument()
  })
})
