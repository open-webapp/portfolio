import { describe, it, expect } from 'vitest'
import { ensureFolderPathSerialized } from './ensureFolder'

// Fake Drive with the same non-atomic check-then-create as drive-sync.
function fakeDrive() {
  const folders: string[] = []
  const project = () => ({
    async ensureFolderPath() {
      const exists = folders.length > 0
      await new Promise((r) => setTimeout(r, 5))
      if (!exists) folders.push('OpenWebApp')
      return 'id'
    },
  })
  return { folders, project }
}

describe('ensureFolderPathSerialized', () => {
  it('concurrent calls create the folder only once', async () => {
    const d = fakeDrive()
    await Promise.all([
      ensureFolderPathSerialized(d.project()),
      ensureFolderPathSerialized(d.project()),
      ensureFolderPathSerialized(d.project()),
    ])
    expect(d.folders).toHaveLength(1)
  })

  it('a rejected call does not block later calls', async () => {
    const bad = { ensureFolderPath: () => Promise.reject(new Error('x')) }
    await expect(ensureFolderPathSerialized(bad)).rejects.toThrow('x')
    await expect(
      ensureFolderPathSerialized({ ensureFolderPath: async () => 'ok' })
    ).resolves.toBe('ok')
  })
})
