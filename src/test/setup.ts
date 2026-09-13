// jsdom 30's native TextEncoder.encode() can return a Uint8Array from a realm
// that doesn't match this test file's `globalThis.Uint8Array` (jsdom/vitest vm
// interop quirk), which breaks `instanceof Uint8Array` and structural equality
// checks. Wrap encode() so its output is always constructed against the
// currently-active Uint8Array.
const NativeTextEncoder = globalThis.TextEncoder

class RealmSafeTextEncoder extends NativeTextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer> {
    const result = super.encode(input)
    return result.constructor === Uint8Array ? result : new Uint8Array(result)
  }
}

globalThis.TextEncoder = RealmSafeTextEncoder as unknown as typeof TextEncoder
