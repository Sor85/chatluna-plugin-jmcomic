// JM 图片解密测试。
// 使用本地生成的小图片验证无切片输出和纵向切片重排。

import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { decodeImage } from '../../src/jm/decode'

const root = join(process.cwd(), '.tmp-decode-test')

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function createColorBlocks(path: string) {
  const pixels = Buffer.from([
    255, 0, 0,
    255, 0, 0,
    0, 0, 255,
    0, 0, 255
  ])

  await sharp(pixels, { raw: { width: 1, height: 4, channels: 3 } }).png().toFile(path)
}

async function createRemainderBlocks(path: string) {
  const pixels = Buffer.from([
    255, 0, 0,
    255, 0, 0,
    0, 0, 255,
    0, 0, 255,
    0, 0, 255
  ])

  await sharp(pixels, { raw: { width: 1, height: 5, channels: 3 } }).png().toFile(path)
}

describe('decodeImage', () => {
  it('outputs a non-empty image when split number is not positive', async () => {
    await mkdir(root, { recursive: true })
    const input = join(root, 'input.png')
    const output = join(root, 'output.png')
    await createColorBlocks(input)

    await decodeImage(await sharp(input).toBuffer(), 0, output)

    expect((await stat(output)).size).toBeGreaterThan(0)
  })

  it('moves lower slices before upper slices when split number is two', async () => {
    await mkdir(root, { recursive: true })
    const input = join(root, 'input.png')
    const output = join(root, 'output.webp')
    await createColorBlocks(input)

    await decodeImage(await sharp(input).toBuffer(), 2, output)

    const { data } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
    const firstPixel = Array.from(data.subarray(0, 3))
    const lastPixel = Array.from(data.subarray(data.length - 3))

    expect(firstPixel[2]).toBeGreaterThan(200)
    expect(firstPixel[0]).toBeLessThan(80)
    expect(lastPixel[0]).toBeGreaterThan(200)
    expect(lastPixel[2]).toBeLessThan(80)
  })

  it('keeps the remainder on the first moved slice', async () => {
    await mkdir(root, { recursive: true })
    const input = join(root, 'remainder.png')
    const output = join(root, 'remainder.webp')
    await createRemainderBlocks(input)

    await decodeImage(await sharp(input).toBuffer(), 2, output)

    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
    const row = (index: number) => Array.from(data.subarray(index * info.channels, index * info.channels + 3))

    expect(row(0)[2]).toBeGreaterThan(row(0)[0])
    expect(row(2)[2]).toBeGreaterThan(row(2)[0])
    expect(row(3)[0]).toBeGreaterThan(row(3)[2])
    expect(row(4)[0]).toBeGreaterThan(row(4)[2])
  })
})
