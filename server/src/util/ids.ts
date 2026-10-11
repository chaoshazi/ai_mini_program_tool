// 可读的短 ID：<前缀>_<base32 时间戳><随机>，避免引入 uuid 依赖。
import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

function encode(n: number, len: number): string {
  let out = ''
  for (let i = 0; i < len; i += 1) {
    out = ALPHABET[n % 32] + out
    n = Math.floor(n / 32)
  }
  return out
}

export function newId(prefix: string): string {
  const time = encode(Date.now(), 9)
  const rand = encode(randomBytes(4).readUInt32BE(0), 7)
  return prefix + '_' + time + rand
}

export function nowIso(): string {
  return new Date().toISOString()
}