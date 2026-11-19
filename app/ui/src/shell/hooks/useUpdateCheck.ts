import { useEffect } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { errorText } from '../../core/errorText'
import { logError } from '../../core/errorLog'
import { notify } from '../../core/notifications'
import { configGet } from '../../settings/appConfig'
import type { ShellDialog } from './dialogTypes'

const START_DELAY_MS = 4000

export function useUpdateCheck(api: ForgeApi, setDialog: (d: ShellDialog) => void) {
  useEffect(() => {
    if (configGet<boolean>('updates', 'check_on_start') === false) return
    let alive = true
    const timer = setTimeout(() => {
      api
        .checkForUpdate()
        .then((update) => {
          if (!alive || !update) return
          notify(`Dito Designer ${update.version} is available.`, {
            kind: 'info',
            timeoutMs: 0,
            actions: [
              { label: 'Details', run: () => setDialog('updates') },
              { label: 'Install and restart', run: () => api.installUpdate().catch((e) => notify(`Update failed: ${errorText(e)}`, { kind: 'error' })) },
            ],
          })
        })
        .catch((e) => logError(`Update check at start failed: ${errorText(e)}`))
    }, START_DELAY_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [api, setDialog])
}
