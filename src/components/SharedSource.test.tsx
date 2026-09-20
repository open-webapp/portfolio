import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { SharedSourceBadge, UnlinkButton } from './SharedSource'

describe('SharedSourceBadge', () => {
  it('renders only the Shared tag', () => {
    const { container } = render(<SharedSourceBadge />)

    expect(container.innerHTML).toBe('<span class="tag tag-accent">Shared</span>')
  })
})

afterEach(cleanup)

describe('UnlinkButton', () => {
  it('calls onUnlink after confirmation', async () => {
    const onUnlink = vi.fn().mockResolvedValue(undefined)
    window.confirm = vi.fn().mockReturnValue(true)
    const { container } = render(<UnlinkButton confirmText="Unlink this shared source?" onUnlink={onUnlink} />)

    fireEvent.click(container.querySelector('button') as HTMLButtonElement)

    await vi.waitFor(() => expect(onUnlink).toHaveBeenCalledTimes(1))
    expect(window.confirm).toHaveBeenCalledWith('Unlink this shared source?')
  })

  it('does not call onUnlink when confirmation is cancelled', () => {
    const onUnlink = vi.fn()
    window.confirm = vi.fn().mockReturnValue(false)
    const { container } = render(<UnlinkButton confirmText="Unlink this shared source?" onUnlink={onUnlink} />)

    fireEvent.click(container.querySelector('button') as HTMLButtonElement)

    expect(onUnlink).not.toHaveBeenCalled()
  })
})
