import { useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { errorText } from '../core/errorText'
import type { LoopbackStatusDto } from '../wire/types'
import { Button } from '../core/ui/controls'

/**
 * Options > ADITO > General (nur wo eine Einrichtung möglich ist, also macOS): die Zusatzadressen 127.0.200.x für die
 * Tunnel. Ohne sie arbeiten die Tunnel mit 127.0.0.1 und dem echten oder einem freien Port, ganz ohne Admin-Recht.
 */
export function LoopbackSetup({ api }: { api: ForgeApi }) {
  const [status, setStatus] = useState<LoopbackStatusDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.loopbackStatus().then(setStatus).catch(() => setStatus(null))
  }, [api])

  if (!status?.setup_possible) return null

  async function setup() {
    setBusy(true)
    setError(null)
    try {
      setStatus(await api.loopbackSetup())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="forge-field">
        <span>Local tunnel addresses</span>
        <span className="forge-field-row">
          {status.available ? (
            <span className="forge-field-ok">Set up. Each service gets its own address with its real port.</span>
          ) : (
            <Button variant="bare" isDisabled={busy} onClick={() => void setup()}>
              {busy ? 'Setting up…' : 'Set up (asks for the admin password once)'}
            </Button>
          )}
        </span>
      </div>
      {!status.available ? <p className="forge-field-hint">Optional. Without it the tunnels use 127.0.0.1 with the real port, or a free one if that is taken. That needs no admin rights.</p> : null}
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )
}
