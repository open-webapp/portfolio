import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagInput } from './TagInput'

function Harness({
  initial = [],
  onChange,
  ariaLabel = 'Tags',
}: {
  initial?: string[]
  onChange?: (tags: string[]) => void
  ariaLabel?: string
}) {
  const [tags, setTags] = useState(initial)
  return (
    <TagInput
      value={tags}
      ariaLabel={ariaLabel}
      onChange={(t) => {
        setTags(t)
        onChange?.(t)
      }}
    />
  )
}

function chips(): string[] {
  return Array.from(document.querySelectorAll('span.tag')).map((el) => el.textContent?.replace(/×$/, '') ?? '')
}

describe('TagInput', () => {
  afterEach(() => {
    cleanup()
  })

  it('adds chip "grocery" on Enter', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Harness onChange={handleChange} />)

    const input = screen.getByLabelText('Tags')
    await user.type(input, 'grocery{enter}')

    expect(handleChange).toHaveBeenCalledWith(['grocery'])
    expect(chips()).toEqual(['grocery'])
  })

  it('comma commits a chip the same as Enter', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Harness onChange={handleChange} />)

    const input = screen.getByLabelText('Tags')
    await user.type(input, 'weekly,')

    expect(handleChange).toHaveBeenCalledWith(['weekly'])
    expect(chips()).toEqual(['weekly'])
  })

  it('strips non-alphanumeric chars live while typing', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByLabelText('Tags') as HTMLInputElement
    await user.type(input, 'gro!@#cery')

    expect(input.value).toBe('grocery')
  })

  it('does not accept an 11th char (input caps at 10 chars)', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByLabelText('Tags') as HTMLInputElement
    await user.type(input, 'abcdefghijk')

    expect(input.value).toBe('abcdefghij')
  })

  it('adding a 6th tag is a no-op (still 5 chips)', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Harness initial={['a', 'b', 'c', 'd', 'e']} onChange={handleChange} />)

    const input = screen.getByLabelText('Tags')
    await user.type(input, 'sixth{enter}')

    expect(chips()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(handleChange).not.toHaveBeenCalled()
  })

  it('case-insensitive dedup: adding "Grocery" when "grocery" exists is a no-op', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Harness initial={['grocery']} onChange={handleChange} />)

    const input = screen.getByLabelText('Tags')
    await user.type(input, 'Grocery{enter}')

    expect(handleChange).not.toHaveBeenCalled()
    expect(chips()).toEqual(['grocery'])
  })

  it("clicking a chip's x removes it", async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Harness initial={['foo', 'bar']} onChange={handleChange} />)

    await user.click(screen.getByRole('button', { name: 'Remove foo' }))

    expect(handleChange).toHaveBeenCalledWith(['bar'])
    expect(chips()).toEqual(['bar'])
  })

  it('renders remove buttons with reset class inside a flex wrapper (no native button chrome)', () => {
    render(<Harness initial={['foo', 'bar']} />)

    const removeBtn = screen.getByRole('button', { name: 'Remove foo' })
    expect(removeBtn.classList.contains('tag-remove')).toBe(true)
    const wrapper = removeBtn.closest('div')
    expect(wrapper?.classList.contains('tag-input')).toBe(true)
  })

  it('Backspace with empty input removes the last chip', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Harness initial={['a', 'b']} onChange={handleChange} />)

    const input = screen.getByLabelText('Tags')
    await user.click(input)
    await user.keyboard('{Backspace}')

    expect(handleChange).toHaveBeenCalledWith(['a'])
    expect(chips()).toEqual(['a'])
  })

  it('Enter with blank input is a no-op (no empty chip)', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Harness onChange={handleChange} />)

    const input = screen.getByLabelText('Tags')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(handleChange).not.toHaveBeenCalled()
    expect(chips()).toEqual([])
  })
})
