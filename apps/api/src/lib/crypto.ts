// AES-256-GCM encryption for integration credentials stored in connected_accounts.
// Key comes from ENCRYPTION_KEY env var (32-byte hex string).
// Output format: base64(iv:authTag:ciphertext) — all components needed to decrypt.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM recommended IV length
const TAG_LENGTH = 16

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate with: openssl rand -hex 32'
    )
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Encrypts a plaintext string.
 * Returns a single base64-encoded token: base64(iv + authTag + ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH })

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

/**
 * Decrypts a token produced by `encrypt`.
 * Throws if the token is tampered with (GCM authentication failure).
 */
export function decrypt(token: string): string {
  const key = getKey()
  const buf = Buffer.from(token, 'base64')

  const iv = buf.subarray(0, IV_LENGTH)
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH })
  decipher.setAuthTag(authTag)

  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
}
