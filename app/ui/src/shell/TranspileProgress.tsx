import { Modal } from './Dialogs'

// Modal progress window while a build runs (original Designer: "Transpiling..." with a running
// stripe, closes by itself). Cancel ends the official transpiler process after a question; the
// experimental engine has no abort hook, so there the button stays dimmed.

export function TranspileProgress({ label, onCancel }: { label: string; onCancel?: () => void }) {
  return (
    <Modal
      title="Transpiling..."
      onClose={() => onCancel?.()}
      footer={
        <button type="button" disabled={!onCancel} title={onCancel ? 'Ends the running build after a question' : 'This engine cannot be cancelled'} onClick={() => onCancel?.()}>
          Cancel
        </button>
      }
    >
      <p>{label}</p>
      <div className="forge-progress-stripe" role="progressbar" aria-label="Build running" aria-busy="true" />
    </Modal>
  )
}
