import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export async function createPasswordHash(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scrypt(password, salt, 64)) as Buffer
  return `scrypt:${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, storedHash: string) {
  const [method, salt, hash] = storedHash.split(':')
  if (method !== 'scrypt' || !salt || !hash) {
    return false
  }

  const derived = (await scrypt(password, salt, 64)) as Buffer
  const expected = Buffer.from(hash, 'hex')
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}
