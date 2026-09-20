export function SharedSourceBadge() {
  return <span className="tag tag-accent">Shared</span>
}

export interface UnlinkButtonProps {
  confirmText: string
  onUnlink: () => Promise<void>
}

export function UnlinkButton({ confirmText, onUnlink }: UnlinkButtonProps) {
  const handleClick = async () => {
    if (!window.confirm(confirmText)) return
    await onUnlink()
  }

  return (
    <button type="button" className="btn-ghost" onClick={() => void handleClick()}>
      Unlink
    </button>
  )
}
