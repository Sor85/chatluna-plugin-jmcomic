// PDF 导出测试。
// 使用 sharp 生成本地小图片，避免测试依赖真实网络。

import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createPdfFromImages } from '../../src/artifact/pdf'

const root = join(process.cwd(), '.tmp-pdf-test')

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('createPdfFromImages', () => {
  it('creates a non-empty pdf', async () => {
    await mkdir(root, { recursive: true })
    const image = join(root, '1.png')
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toFile(image)

    const output = join(root, 'out.pdf')
    await createPdfFromImages([image], output)

    expect((await stat(output)).size).toBeGreaterThan(0)
  })

  it('creates an encrypted pdf when password is provided', async () => {
    await mkdir(root, { recursive: true })
    const image = join(root, 'encrypted.png')
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toFile(image)

    const output = join(root, 'encrypted.pdf')
    await createPdfFromImages([image], output, 'secret')

    expect((await stat(output)).size).toBeGreaterThan(0)
    expect((await readFile(output)).toString('latin1')).toContain('/Encrypt')
  })
})
