import { useEffect, useRef, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { errorText } from '../core/errorText'
import type { SshKeyInfoDto } from '../wire/types'
import { Input } from '../core/ui/controls'

/** Platzhalter im Feld, solange eine geprüfte Passphrase gemerkt ist. Die echte Passphrase kommt nie in die Oberfläche zurück. */
export const PASSPHRASE_MASK = '********'

/**
 * Unter dem Schlüsselpfad der Optionen: prüft die Schlüsseldatei von selbst und zeigt das Feld für die Passphrase
 * nur, wenn der Schlüssel eine hat. Die Passphrase wird beim Tippen geprüft und im System-Schlüsselbund gemerkt,
 * nie in `designer.conf`. Danach steht dauerhaft `********` im Feld. Wer die Sternchen löscht, vergisst sie und
 * kann eine neue eingeben.
 */
export function SshKeyPassphrase({ api, keyPath }: { api: ForgeApi; keyPath: string }) {
  const [info, setInfo] = useState<SshKeyInfoDto | null>(null)
  const [value, setValue] = useState('')
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null)
  const latest = useRef(0)
  const stored = value === PASSPHRASE_MASK

  // Schlüsseldatei prüfen, kurz nach der letzten Eingabe. Eine gemerkte Passphrase wird gleich gegen die Datei geprüft.
  useEffect(() => {
    const path = keyPath.trim()
    const run = ++latest.current
    setInfo(null)
    setState(null)
    setValue('')
    if (!path) return
    const timer = setTimeout(async () => {
      const found = await api.sshKeyInspect(path).catch(() => null)
      if (run !== latest.current) return
      setInfo(found)
      if (!found?.exists || !found.encrypted) return
      if (!(await api.sshKeyHasPassphrase(path).catch(() => false)) || run !== latest.current) return
      setValue(PASSPHRASE_MASK)
      await api.sshKeyUnlock(path, null).then(
        () => run === latest.current && setState({ ok: true, text: 'Passphrase is correct.' }),
        (e) => run === latest.current && setState({ ok: false, text: errorText(e) }),
      )
    }, 400)
    return () => clearTimeout(timer)
  }, [api, keyPath])

  // Eingetippte Passphrase prüfen und merken.
  useEffect(() => {
    if (!value || value === PASSPHRASE_MASK) return
    const path = keyPath.trim()
    const run = latest.current
    setState({ ok: true, text: 'Checking…' })
    const timer = setTimeout(async () => {
      try {
        await api.sshKeySavePassphrase(path, value)
        if (run !== latest.current) return
        setValue(PASSPHRASE_MASK)
        setState({ ok: true, text: 'Passphrase is correct.' })
      } catch (e) {
        if (run === latest.current) setState({ ok: false, text: errorText(e) })
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [api, keyPath, value])

  function change(next: string) {
    if (stored && next !== '') {
      // Wer in die Sternchen tippt, ersetzt sie: nur das Neue zählt.
      next = next.replace(PASSPHRASE_MASK, '')
    }
    if (next === '' && stored) {
      void api.sshKeyForgetPassphrase(keyPath.trim()).catch(() => {})
      setState(null)
    }
    setValue(next)
  }

  if (!keyPath.trim() || !info) return null
  if (info.problem || !info.exists) {
    return (
      <p className="forge-field-error" role="alert">
        {info.problem ?? 'File not found.'}
      </p>
    )
  }
  if (!info.encrypted) return <p className="forge-field-hint">Key found. It has no passphrase.</p>

  return (
    <>
      <label className="forge-field">
        <span>Passphrase of the key</span>
        <span className="forge-field-row">
          <Input
            type="password"
            autoComplete="off"
            aria-label="SSH key passphrase"
            placeholder="Passphrase"
            value={value}
            onFocus={(e) => stored && e.currentTarget.select()}
            onChange={(e) => change(e.target.value)}
          />
        </span>
      </label>
      {state ? (
        <p className={state.ok ? (state.text === 'Checking…' ? 'forge-field-hint' : 'forge-field-ok') : 'forge-field-error'} role={state.ok ? 'status' : 'alert'}>
          {state.text}
        </p>
      ) : (
        <p className="forge-field-hint">The key is protected by a passphrase. Enter it once; it is checked and kept in the system credential store.</p>
      )}
    </>
  )
}
