let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs every Drive `ensureFolderPath` through one app-wide queue. drive-sync's
 * ensureFolderPath is check-then-create (non-atomic), and each facade instance
 * is independent, so concurrent calls on a fresh Drive would each create their
 * own `OpenWebApp/Portfolio` folders. Serializing lets later calls find what
 * the first one created.
 */
export function ensureFolderPathSerialized(project: {
  ensureFolderPath(): Promise<string>
}): Promise<string> {
  const run = queue.then(() => project.ensureFolderPath())
  queue = run.catch(() => undefined)
  return run
}
