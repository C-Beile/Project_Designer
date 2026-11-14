import { useState } from 'react'
import { Modal } from '../core/Modal'
import { Button, Input } from '../core/ui/controls'

// Confirmations behind the tree's context menu. Nothing is deleted or created by the menu click
// itself; only the confirming button inside these dialogs runs the action.

export function ConfirmDeleteDialog({ name, onConfirm, onClose }: { name: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      title="Delete"
      onClose={onClose}
      footer={
        <>
          <Button variant="bare" onClick={onConfirm}>
            Delete
          </Button>
          <Button variant="bare" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <p>
        Delete <strong>{name}</strong> with all its files?
      </p>
      <p className="forge-field-hint">This cannot be undone here. Other objects that refer to it are not changed.</p>
    </Modal>
  )
}

const VALID = /^[A-Za-z0-9_-]+$/

export function PasteNameDialog({ folder, initial, onConfirm, onClose }: { folder: string; initial: string; onConfirm: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial)
  const ok = VALID.test(name)
  return (
    <Modal
      title="Paste"
      onClose={onClose}
      footer={
        <>
          <Button variant="bare" isDisabled={!ok} onClick={() => onConfirm(name)}>
            Paste
          </Button>
          <Button variant="bare" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <label className="forge-field">
        <span>Name of the new {folder} object</span>
        <Input
          type="text"
          value={name}
          aria-label="New object name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ok) onConfirm(name)
          }}
        />
      </label>
      {ok ? null : <p className="forge-field-error">Use letters, digits, '_' and '-' only.</p>}
    </Modal>
  )
}

export function RenameDialog({ folder, initial, onConfirm, onClose }: { folder: string; initial: string; onConfirm: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial)
  const ok = VALID.test(name) && name !== initial
  return (
    <Modal
      title="Rename"
      onClose={onClose}
      footer={
        <>
          <Button variant="bare" isDisabled={!ok} onClick={() => onConfirm(name)}>
            Preview
          </Button>
          <Button variant="bare" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <label className="forge-field">
        <span>New name of the {folder} object</span>
        <Input
          type="text"
          value={name}
          aria-label="New name"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ok) onConfirm(name)
          }}
        />
      </label>
      {VALID.test(name) ? null : <p className="forge-field-error">Use letters, digits, '_' and '-' only.</p>}
      <p className="forge-field-hint">The next step lists every place that changes. Nothing is renamed before you confirm it there.</p>
    </Modal>
  )
}
