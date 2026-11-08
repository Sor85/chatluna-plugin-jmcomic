import { createDecipheriv, createHash, type Encoding } from 'node:crypto'
import { JM_APP_DATA_SECRET, JM_APP_TOKEN_SECRET, JM_APP_VERSION } from './constants'

export function md5Hex(input: string, inputEncoding: Encoding = 'utf-8') {
  return createHash('md5').update(input, inputEncoding).digest('hex')
}

export function createTokenHeaders(timestamp: number, secret = JM_APP_TOKEN_SECRET) {
  return {
    token: md5Hex(`${timestamp}${secret}`),
    tokenparam: `${timestamp},${JM_APP_VERSION}`
  }
}

// JM 的加密 JSON 边界；调用方校验实际使用的响应字段。
export function decodeEncryptedJson<T>(base64: string, timestamp: number | string, secret = JM_APP_DATA_SECRET): T {
  const key = Buffer.from(md5Hex(`${timestamp}${secret}`))
  const decipher = createDecipheriv('aes-256-ecb', key, null)
  const decrypted = Buffer.concat([decipher.update(Buffer.from(base64, 'base64')), decipher.final()])
  return JSON.parse(decrypted.toString('utf-8'))
}
