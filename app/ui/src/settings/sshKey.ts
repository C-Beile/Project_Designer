import { useCallback, useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'

// Path of the SSH key (.ppk) for the tunnels. Only the path is stored in the app settings, never
// the key content or a passphrase; it is pre-filled in the Services tab and the tunnel editor.

let cached: string | null = null

export function useSshKeyPath(api: ForgeApi): [string, (path: string) => void] {
  const [path, setPath] = useState(cached ?? '')

  useEffect(() => {
    let cancelled = false
    api
      .getSettings()
      .then((s) => {
        const stored = s.ssh_key_path ?? ''
        cached = stored
        if (!cancelled) setPath((current) => (current === '' ? stored : current))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [api])

  const update = useCallback(
    (next: string) => {
      setPath(next)
      cached = next
      api
        .getSettings()
        .then((s) => api.setSettings({ ...s, ssh_key_path: next.trim() || null }))
        .catch(() => {})
    },
    [api],
  )

  return [path, update]
}

/** Test helper: forgets the remembered path between tests. */
export function _resetSshKeyCacheForTests(): void {
  cached = null
}
