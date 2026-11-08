import { createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import archiver from 'archiver'
import encryptedZip from 'archiver-zip-encrypted'

export interface ZipSource {
  directory: string
  destpath: string | false
}

async function writeZip(outputPath: string, password: string | undefined, level: number, append: (archive: archiver.Archiver) => void, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (password && !archiver.isRegisteredFormat('zip-encrypted')) archiver.registerFormat('zip-encrypted', encryptedZip)
  const options = { zlib: { level }, encryptionMethod: password ? 'aes256' : undefined, password }
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath)
    const archive = archiver.create(password ? 'zip-encrypted' : 'zip', options)
    const fail = (error: unknown) => {
      signal?.removeEventListener('abort', abort)
      archive.abort()
      output.destroy()
      reject(error)
    }
    const abort = () => fail(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    output.on('close', () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    })
    output.on('error', fail)
    archive.on('error', fail)
    archive.on('warning', fail)
    archive.pipe(output)
    try {
      append(archive)
      void archive.finalize().catch(fail)
    } catch (error) {
      fail(error)
    }
  })
}

export async function createZipFromDirectory(sources: ZipSource[], outputPath: string, password: string | undefined, level: number, signal?: AbortSignal): Promise<void> {
  for (const source of sources) {
    if (!(await stat(source.directory)).isDirectory()) throw new Error(`ZIP source is not a directory: ${source.directory}`)
  }
  await writeZip(outputPath, password, level, (archive) => {
    for (const source of sources) archive.directory(source.directory, source.destpath)
  }, signal)
}

export async function createZipFromFile(inputPath: string, outputPath: string, password: string | undefined, level: number, signal?: AbortSignal): Promise<void> {
  await writeZip(outputPath, password, level, (archive) => {
    archive.file(inputPath, { name: basename(inputPath) })
  }, signal)
}
