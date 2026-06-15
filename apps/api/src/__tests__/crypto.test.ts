import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encrypt, decrypt } from '../lib/crypto.js'

const TEST_KEY = 'a'.repeat(64) // 32 bytes hex, fine for tests

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY
})

afterEach(() => {
  delete process.env.ENCRYPTION_KEY
})

describe('encrypt / decrypt', () => {
  it('round-trips a plain string', () => {
    const original = '{"access_token":"tok_abc","refresh_token":"ref_xyz"}'
    expect(decrypt(encrypt(original))).toBe(original)
  })

  it('round-trips unicode and special characters', () => {
    const original = 'zoho_org_id=₹1000&secret=p@$$w0rd!'
    expect(decrypt(encrypt(original))).toBe(original)
  })

  it('produces different ciphertexts each call (random IV)', () => {
    const plaintext = 'same plaintext'
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
    // but both decrypt correctly
    expect(decrypt(a)).toBe(plaintext)
    expect(decrypt(b)).toBe(plaintext)
  })

  it('throws on tampered ciphertext', () => {
    const token = encrypt('secret')
    const buf = Buffer.from(token, 'base64')
    // flip a byte in the ciphertext region
    buf[buf.length - 1] ^= 0xff
    const tampered = buf.toString('base64')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('throws when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY
    expect(() => encrypt('anything')).toThrow(/ENCRYPTION_KEY/)
  })

  it('throws when ENCRYPTION_KEY is the wrong length', () => {
    process.env.ENCRYPTION_KEY = 'tooshort'
    expect(() => encrypt('anything')).toThrow(/ENCRYPTION_KEY/)
  })
})
