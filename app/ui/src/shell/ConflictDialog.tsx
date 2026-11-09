import { Modal } from '../core/Modal'

// Datei auf der Platte wurde geändert, während der Editor ungespeicherte Änderungen hat.
export function ConflictDialog({ label, onResolve, onClose }: { label: string; onResolve: (choice: 'overwrite' | 'reload') => void; onClose: () => void }) {
  return (
    <Modal
      title="File changed on disk"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={() => onResolve('overwrite')}>
            Overwrite file on disk
          </button>
          <button type="button" onClick={() => onResolve('reload')}>
            Reload from disk
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p>{label} was changed on disk (for example by Git) after you opened it, and you have unsaved edits.</p>
      <p className="forge-field-hint">Overwrite keeps your edits and backs up the disk version first. Reload discards your edits and shows the disk version.</p>
    </Modal>
  )
}
