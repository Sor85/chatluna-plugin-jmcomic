// JM 图片解密。
// 部分图片需要按高度切片重排，规则由 photo split number 决定。

import sharp from 'sharp'

// 解码 JM 图片并写入目标路径。
export async function decodeImage(input: Buffer, splitNumber: number, outputPath: string): Promise<void> {
  if (splitNumber <= 0) {
    await sharp(input).toFile(outputPath)
    return
  }

  const metadata = await sharp(input).metadata()
  const height = metadata.height ?? 0
  const width = metadata.width ?? 0

  if (height < splitNumber || width <= 0) {
    await sharp(input).toFile(outputPath)
    return
  }

  const over = height % splitNumber
  const move = Math.floor(height / splitNumber)
  const parts: Array<{ input: Buffer; top: number; left: number }> = []

  for (let i = 0; i < splitNumber; i++) {
    const partHeight = i === 0 ? move + over : move
    const sourceTop = height - over - move * (i + 1)
    const targetTop = i === 0 ? 0 : over + move * i
    const part = await sharp(input)
      .extract({ left: 0, top: sourceTop, width, height: partHeight })
      .toBuffer()

    parts.push({ input: part, top: targetTop, left: 0 })
  }

  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite(parts)
    .webp()
    .toFile(outputPath)
}
