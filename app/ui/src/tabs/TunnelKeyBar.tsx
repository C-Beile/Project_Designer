import type { ForgeApi } from '../api/ForgeApi'
import { isMacPlatform } from '../core/shortcuts'
import { Icon } from '../core/icons/Icon'
import { Button } from '../core/ui/controls'
import { SshKeyPassphrase } from '../shell/SshKeyPassphrase'

const KEY_ERROR = /\b(key|ppk|passphrase|publickey|public key|auth(entication)?|permission denied|identity|agent|pageant)\b/i

export const looksLikeKeyProblem = (texts: string[]): boolean => texts.some((t) => KEY_ERROR.test(t))

/** Der SSH-Schlüssel der Tunnel direkt in der Tunnel-Ansicht wählen. Bei einem Fehler, der nach Schlüssel aussieht, wird die Karte hervorgehoben. */
export function TunnelKeyBar({ api, keyFile, onKeyFile, errors }: { api: ForgeApi; keyFile: string; onKeyFile: (path: string) => void; errors: string[] }) {
  const missing = keyFile.trim() === ''
  const problem = looksLikeKeyProblem(errors)
  const attention = problem

  async function choose() {
    const mac = isMacPlatform()
    const picked = await api.pickFile('Choose the SSH key', mac ? 'OpenSSH key' : 'PuTTY key', mac ? [] : ['ppk']).catch(() => null)
    if (picked) onKeyFile(picked)
  }

  return (
    <section className={`tunnel-key${attention ? ' is-attention' : ''}`} aria-label="SSH key">
      <span className="tunnel-key-icon" aria-hidden="true">
        <Icon name="key" weight="bold" color={attention ? 'warning' : missing ? 'muted' : 'success'} />
      </span>
      <div className="tunnel-key-body">
        <div className="tunnel-key-title">
          SSH key
          <span className={`tunnel-key-state${missing ? '' : ' is-set'}`}>{missing ? 'none chosen' : 'chosen'}</span>
        </div>
        <div className="tunnel-key-path" title={keyFile}>
          {missing ? 'No key chosen. The tunnels use the keys of Pageant or the ssh-agent.' : keyFile}
        </div>
        {attention ? (
          <div className="tunnel-key-hint" role="alert">
            {missing ? 'The connection failed and may need a key. Choose your SSH key.' : 'The connection failed. Check the key and its passphrase, or choose another key.'}
          </div>
        ) : null}
        <SshKeyPassphrase api={api} keyPath={keyFile} />
      </div>
      <div className="tunnel-key-actions">
        <Button variant="bare" className="tunnel-key-choose" onClick={() => void choose()}>
          {missing ? 'Choose key…' : 'Change…'}
        </Button>
        {!missing ? (
          <Button variant="bare" aria-label="Remove SSH key" title="Remove the key from the settings" onClick={() => onKeyFile('')}>
            <Icon name="x" weight="bold" size="sm" />
          </Button>
        ) : null}
      </div>
    </section>
  )
}
