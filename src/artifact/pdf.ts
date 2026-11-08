import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

export async function createPdfFromImages(imagePaths: string[], outputPath: string, password?: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const { default: PDFDocument } = await import('pdfkit')
  const doc = new PDFDocument({
    autoFirstPage: false, margin: 0,
    userPassword: password || undefined, ownerPassword: password || undefined
  })
  const output = createWriteStream(outputPath)
  const done = pipeline(doc, output, { signal })
  // 图片解码期间输出流也可能失败，立即挂接拒绝处理避免未处理异常。
  void done.catch(() => {})
  try {
    for (const imagePath of imagePaths) {
      signal?.throwIfAborted()
      const { data, info } = await sharp(await readFile(imagePath)).png().toBuffer({ resolveWithObject: true })
      doc.addPage({ size: [info.width, info.height], margin: 0 })
      doc.image(data, 0, 0, { width: info.width, height: info.height })
    }
    signal?.throwIfAborted()
    doc.end()
    await done
  } catch (error) {
    doc.destroy()
    output.destroy()
    await done.catch(() => {})
    throw error
  }
}
