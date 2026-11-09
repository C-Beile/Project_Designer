// Options > Team: Hinweise zu Git (reiner Text, kein Zustand).
export function GitOptionsPage() {
  return (
    <>
      <h3>Team</h3>
      <p>Git actions run from Team &gt; Commit, Pull, Push and Switch Branch. Every action needs its own click; commit messages are a single line without co-author lines, and package-lock.json is deselected by default.</p>
      <p className="forge-field-hint">Git is used through the git installation on this computer.</p>
    </>
  )
}
