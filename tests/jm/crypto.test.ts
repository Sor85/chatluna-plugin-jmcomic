// JM 加密工具和实体规则测试。
// 这些规则来自移动端 API，改错会直接导致请求失败或图片解密错误。

import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTokenHeaders, decodeEncryptedJson, md5Hex } from '../../src/jm/crypto'
import { createPhotoEntity } from '../../src/jm/entities'

function createPhoto(id: number, image = '00001.webp') {
  return createPhotoEntity({ id, name: 'p', images: [image] })
}

describe('createTokenHeaders', () => {
  it('builds token and tokenparam', () => {
    const headers = createTokenHeaders(1700000000000)
    expect(headers.token).toBe(md5Hex('170000000000018comicAPP'))
    expect(headers.tokenparam).toBe('1700000000000,1.7.9')
  })
})

describe('photo split numbers', () => {
  it('uses zero split when photo id is below scramble id', () => {
    const photo = createPhoto(100)

    expect(photo.getSplitNumbers(200)).toEqual([0])
  })

  it('uses ten splits before hash scramble threshold', () => {
    expect(createPhoto(268849).getSplitNumbers(1)).toEqual([10])
  })

  it('uses ascii char code hash rule before 421926 threshold', () => {
    expect(createPhoto(268850).getSplitNumbers(1)).toEqual([6])
  })

  it('uses base eight ascii char code hash rule after 421926 threshold', () => {
    expect(createPhoto(421926).getSplitNumbers(1)).toEqual([14])
  })
})

describe('decodeEncryptedJson', () => {
  it('decodes encrypted json payload', () => {
    const timestamp = 1700000000000
    const secret = '18comicAPP'
    const key = Buffer.from(md5Hex(`${timestamp}${secret}`))
    const cipher = createCipheriv('aes-256-ecb', key, null)
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify({ ok: true, value: 7 }), 'utf-8')),
      cipher.final()
    ]).toString('base64')

    expect(decodeEncryptedJson<{ ok: boolean; value: number }>(encrypted, timestamp, secret)).toEqual({
      ok: true,
      value: 7
    })
  })
})
