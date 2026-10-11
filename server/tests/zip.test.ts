// 零依赖 ZIP 写入：结构正确、可复现，能被标准解压工具读出。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { createZip } from '../src/runtime/zip.js'

interface ReadEntry {
  name: string
  data: Buffer
  crc: number
}

/** 最小 ZIP 读取器：只按中央目录解析，用来验证我们写出的包结构自洽。 */
function readZip(buffer: Buffer): ReadEntry[] {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(eocd > 0, '缺少 EOCD')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries: ReadEntry[] = []
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, '中央目录签名不对')
    const method = buffer.readUInt16LE(offset + 10)
    const crc = buffer.readUInt32LE(offset + 16)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const size = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, '本地头签名不对')
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const bodyStart = localOffset + 30 + localNameLength
    const body = buffer.subarray(bodyStart, bodyStart + compressedSize)
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body)
    assert.equal(data.byteLength, size, name + ' 解压后长度一致')
    entries.push({ name, data, crc })
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32)
  }
  return entries
}

test('写入的 zip 能被解析回原内容', () => {
  const entries = [
    { name: 'README.md', data: Buffer.from('# 标题\n中文内容\n', 'utf8') },
    { name: 'client/src/pages.json', data: Buffer.from('{"pages":[]}', 'utf8') },
    { name: 'server/src/index.ts', data: Buffer.from('console.log(1)\n'.repeat(30), 'utf8') },
  ]
  const zip = createZip(entries)
  assert.equal(zip.subarray(0, 2).toString('binary'), 'PK')
  const read = readZip(zip)
  assert.equal(read.length, 3)
  for (const original of entries) {
    const found = read.find((item) => item.name === original.name)
    assert.ok(found, '缺少条目 ' + original.name)
    assert.equal(found.data.toString('utf8'), original.data.toString('utf8'))
    assert.ok(found.crc !== 0, 'CRC 不应为 0')
  }
})

test('同样输入产出同样的字节（可复现）', () => {
  const entries = [{ name: 'a.txt', data: Buffer.from('hello 世界', 'utf8') }]
  assert.equal(createZip(entries).equals(createZip(entries)), true)
})