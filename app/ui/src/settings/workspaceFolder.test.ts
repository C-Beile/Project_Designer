import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseWorkspaceFolder, getWorkspaceFolder, getWorkspaceFolders, setWorkspaceFolder, subscribeWorkspaceFolders, takePendingWorkspaceFolder } from './workspaceFolder'

beforeEach(() => {
  window.localStorage.clear()
  takePendingWorkspaceFolder()
})

describe('workspace folders', () => {
  it('remembers the folders newest first without duplicates and tells the listeners', () => {
    const changed = vi.fn()
    const off = subscribeWorkspaceFolders(changed)
    setWorkspaceFolder('C:/Repos')
    setWorkspaceFolder('D:/Work')
    setWorkspaceFolder('c:/repos/')
    expect(getWorkspaceFolders()).toEqual(['c:/repos/', 'D:/Work'])
    expect(getWorkspaceFolder()).toBe('c:/repos/')
    expect(changed).toHaveBeenCalledTimes(3)
    off()
  })

  it('hands a chosen folder to the dialog once', () => {
    chooseWorkspaceFolder('E:/Pick')
    expect(takePendingWorkspaceFolder()).toBe('E:/Pick')
    expect(takePendingWorkspaceFolder()).toBeNull()
  })
})
