import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PullResultDialog, relativeTime } from './PullResultDialog'
import { createMockForgeApi } from '../../test/mockApi'

describe('PullResultDialog', () => {
  it('says how long ago in plain words', () => {
    const now = Date.parse('2026-11-11T12:00:00Z')
    expect(relativeTime('2026-11-11T11:59:50Z', now)).toBe('just now')
    expect(relativeTime('2026-11-11T11:30:00Z', now)).toBe('30 min ago')
    expect(relativeTime('2026-11-11T09:00:00Z', now)).toBe('3 h ago')
    expect(relativeTime('2026-11-09T12:00:00Z', now)).toBe('2 days ago')
  })

  it('lists the new commits with their author and shows the files of a commit on click', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    api.scmCommitFiles = async () => [{ status: 'M', path: 'entity/Person_entity/Person_entity.aod' }]
    render(
      <PullResultDialog
        api={api}
        root="C:/p"
        onClose={() => {}}
        result={{ branch: 'main', dependenciesChanged: true, commits: [{ hash: 'abcdef1234', author: 'Anna Beispiel', date: '2026-11-11T08:00:00Z', subject: 'Fix person import' }] }}
      />,
    )
    expect(screen.getByText('1 new commit')).toBeInTheDocument()
    expect(screen.getByText(/from Anna Beispiel/)).toBeInTheDocument()
    expect(screen.getByText(/run/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Fix person import/ }))
    expect(await screen.findByText('entity/Person_entity/Person_entity.aod')).toBeInTheDocument()
  })
})
