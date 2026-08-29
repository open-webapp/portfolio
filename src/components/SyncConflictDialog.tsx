import { useState } from 'react'

export interface SyncConflictDialogProps {
  remoteModifiedTime?: string
  /** RFC3339 string or epoch-ms (drive-sync surfaces `lastRestoredAt` as epoch-ms). */
  localRestoredAt?: string | number
  onOverwriteLocalWithRemote: () => Promise<void>
  onOverwriteRemoteWithLocal: () => Promise<void>
  onCancel: () => void
}

const CROSS_PASSWORD_MESSAGE =
  'This Drive backup was saved with a different password. Use Settings > Drive > Restore from Drive to enter it.'
const GENERIC_MESSAGE = 'Drive changed again — close and retry sync.'

function formatTimestamp(value?: string | number): string {
  if (value === undefined || value === '') return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString()
}

/**
 * SyncConflictDialog: shown when a Drive backup changed under a sync attempt.
 * Lets the user resolve by overwriting one side with the other, or cancelling.
 * Owns local busy + inline-error state; the two overwrite handlers are async
 * props that may throw (DriveDecryptError → cross-password copy; anything else
 * → a generic retry message).
 */
export function SyncConflictDialog({
  remoteModifiedTime,
  localRestoredAt,
  onOverwriteLocalWithRemote,
  onOverwriteRemoteWithLocal,
  onCancel,
}: SyncConflictDialogProps) {
  const [busy, setBusy] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  const runOverwrite = async (action: () => Promise<void>) => {
    setBusy(true)
    setInlineError(null)
    try {
      await action()
    } catch (err) {
      if ((err as { name?: string })?.name === 'DriveDecryptError') {
        setInlineError(CROSS_PASSWORD_MESSAGE)
      } else {
        setInlineError(GENERIC_MESSAGE)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" style={{ zIndex: 1000 }}>
      <div className="dialog blueprint" style={{ width: 'min(92vw, 440px)' }}>
        <div className="dialog-title">Drive backup changed</div>
        <div className="dialog-body" style={{ textAlign: 'left' }}>
          <div className="text-muted" style={{ fontSize: '13px', marginBottom: '14px' }}>
            The backup in Google Drive changed since this device last synced. Choose which copy to
            keep — this overwrites the other one.
          </div>
          <div className="text-muted" style={{ fontSize: '12px', marginBottom: '6px' }}>
            Remote backup updated: {formatTimestamp(remoteModifiedTime)}
          </div>
          <div className="text-muted" style={{ fontSize: '12px', marginBottom: '6px' }}>
            Local copy restored: {formatTimestamp(localRestoredAt)}
          </div>
          {inlineError && (
            <div role="alert" style={{ color: '#8a3c2e', fontSize: '12px', marginTop: '6px' }}>
              {inlineError}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-secondary blueprint"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary blueprint"
            disabled={busy}
            onClick={() => void runOverwrite(onOverwriteRemoteWithLocal)}
          >
            Overwrite remote with local
          </button>
          <button
            type="button"
            className="btn btn-primary blueprint"
            disabled={busy}
            onClick={() => void runOverwrite(onOverwriteLocalWithRemote)}
          >
            Overwrite local with remote
          </button>
        </div>
      </div>
    </div>
  )
}
