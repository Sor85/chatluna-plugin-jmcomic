// JM 测试加密辅助函数。
// 让客户端测试和域名服务器测试共用同一套 AES 加密规则。

import { createCipheriv } from 'node:crypto'
import { JM_API_DOMAIN_SERVER_SECRET, JM_APP_DATA_SECRET } from '../../src/jm/constants'
import { md5Hex } from '../../src/jm/crypto'

// 加密 JM API JSON，测试代码用它生成移动端接口返回值。
export function encryptJmJson(value: unknown, timestamp: number | string, secret = JM_APP_DATA_SECRET): string {
  const key = Buffer.from(md5Hex(`${timestamp}${secret}`))
  const cipher = createCipheriv('aes-256-ecb', key, null)
  return Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), 'utf-8')),
    cipher.final()
  ]).toString('base64')
}

// 加密 JM 域名服务器响应，域名服务器的 timestamp 为空字符串。
export function encodeDomainServerResponse(value: unknown): string {
  return encryptJmJson(value, '', JM_API_DOMAIN_SERVER_SECRET)
}
