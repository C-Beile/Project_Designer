import { runCommandById } from '../../core/plugins/registry'
import { useScm } from '../../core/scm'

// Options > Team: Hinweise zu Git und die Verknüpfung des aktiven Projekts mit seinem Repository.
export function GitOptionsPage() {
  const scm = useScm()
  const hasProject = scm.root.trim() !== ''
  return (
    <>
      <h3>Git</h3>
      <p>Git actions run from Team &gt; Git: Commit, Pull, Push and Switch Branch. Every action needs its own click; commit messages are a single line without co-author lines, and package-lock.json is deselected by default.</p>
      <p>
        <button type="button" disabled={!hasProject} onClick={() => runCommandById('team.repository')}>
          Repository...
        </button>
      </p>
      <p className="forge-field-hint">{hasProject ? 'Shows or changes the remote repository (origin) of the active project, or connects a folder that has none.' : 'Open a project first.'}</p>
      <p className="forge-field-hint">Git is used through the git installation on this computer.</p>
    </>
  )
}
