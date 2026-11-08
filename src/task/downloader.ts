import { mkdir, readdir, readFile, rename, stat, statfs, utimes, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createPdfFromImages } from '../artifact/pdf'
import { createZipFromDirectory, type ZipSource } from '../artifact/zip'
import type { Config, OutputFormat } from '../config'
import { ArtifactError } from '../errors'
import { validateId, type JmClient } from '../jm/client'
import { decodeImage } from '../jm/decode'
import type { JmAlbumEntity, JmPhotoEntity } from '../jm/types'
import type { Logger } from '../types'
import { formatOutputName, removeDirIfExists, sanitizeFileName } from '../utils/file'
import { limitAll } from '../utils/limit'

export interface DownloadAlbumInput {
  albumId: string
  format: OutputFormat
  password?: string
  signal?: AbortSignal
}

export interface DownloadAlbumResult {
  albumId: string
  title: string
  filePath: string
  fileName: string
  extension: OutputFormat
  fileUrl?: string
}

export class AlbumDownloader {
  constructor(
    private root: string,
    private client: Pick<JmClient, 'getAlbumById' | 'requestScrambleId' | 'downloadImage'>,
    private config: Config,
    private logger: Logger
  ) {}

  async download(input: DownloadAlbumInput): Promise<DownloadAlbumResult> {
    validateId(input.albumId)
    input.signal?.throwIfAborted()
    await this.ensureFreeDiskSpace()
    const album = await this.client.getAlbumById(input.albumId, input.signal)
    validateId(album.id)
    if (album.id !== input.albumId) throw new ArtifactError('Album ID does not match request')
    this.validateAlbum(album)
    const albumDir = join(this.root, 'album', album.id)
    // 每个产物独立存放，旧下载链接不会被下一次同本导出覆盖。
    const outputDir = join(albumDir, 'output', randomUUID())
    await mkdir(outputDir, { recursive: true })
    const now = new Date()
    await utimes(albumDir, now, now)
    await removeDirIfExists(join(albumDir, 'decoded'))
    for (const photo of album.photos) {
      input.signal?.throwIfAborted()
      await this.downloadAndDecodePhoto(photo, albumDir, album.photos.length > 1, input.signal)
    }
    input.signal?.throwIfAborted()
    const outputName = `${formatOutputName(this.config.fileName, album.name, album.id)}.${input.format}`
    const filePath = join(outputDir, outputName)
    const temporaryPath = join(outputDir, `${randomUUID()}.tmp`)
    try {
      const decodedRoot = join(albumDir, 'decoded')
      if (input.format === 'pdf') {
        const paths = album.photos.flatMap((photo) => photo.images.map((image) =>
          join(decodedRoot, ...(album.photos.length > 1 ? [photo.id] : []), sanitizeFileName(image))))
        await createPdfFromImages(paths, temporaryPath, input.password, input.signal)
      } else {
        const sources: ZipSource[] = album.photos.length > 1
          ? album.photos.map((photo, index) => ({ directory: join(decodedRoot, photo.id), destpath: `第${index + 1}章` }))
          : [{ directory: decodedRoot, destpath: false }]
        await createZipFromDirectory(sources, temporaryPath, input.password, this.config.zipLevel, input.signal)
      }
      input.signal?.throwIfAborted()
      await rename(temporaryPath, filePath)
    } catch (error) {
      await removeDirIfExists(outputDir)
      throw error
    }
    const completedAt = new Date()
    await utimes(albumDir, completedAt, completedAt)
    return { albumId: album.id, title: album.name, filePath, fileName: outputName, extension: input.format }
  }

  async cleanup(albumId: string): Promise<void> {
    validateId(albumId)
    if (!this.config.cache) await removeDirIfExists(join(this.root, 'album', albumId))
  }

  async cleanupExpired(now = new Date(), active: ReadonlySet<string> = new Set()): Promise<void> {
    const albumRoot = join(this.root, 'album')
    let entries: string[]
    try {
      entries = await readdir(albumRoot)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    const expiresBefore = now.getTime() - this.config.fileExpireHours * 60 * 60 * 1000
    for (const entry of entries) {
      if (active.has(entry) || !/^\d+$/.test(entry)) continue
      const albumDir = join(albumRoot, entry)
      const stats = await stat(albumDir)
      if (stats.isDirectory() && stats.mtimeMs <= expiresBefore) await removeDirIfExists(albumDir)
    }
  }

  private validateAlbum(album: JmAlbumEntity) {
    if (!album.photos.length) throw new ArtifactError(`本子无图片：${album.id}`)
    for (const photo of album.photos) {
      validateId(photo.id)
      if (!photo.images.length) throw new ArtifactError(`章节无图片：${photo.id}`)
      const names = photo.images.map(sanitizeFileName)
      if (new Set(names).size !== names.length) throw new ArtifactError('图片文件名发生冲突')
    }
    const pageCount = album.photos.reduce((total, photo) => total + photo.images.length, 0)
    if (pageCount > this.config.maxDownloadPages) throw new ArtifactError(`本子页数过多：${pageCount} 页，最多允许 ${this.config.maxDownloadPages} 页`)
  }

  private async downloadAndDecodePhoto(photo: JmPhotoEntity, albumDir: string, nested: boolean, signal?: AbortSignal) {
    const originDir = nested ? join(albumDir, 'origin', photo.id) : join(albumDir, 'origin')
    const decodedDir = nested ? join(albumDir, 'decoded', photo.id) : join(albumDir, 'decoded')
    await mkdir(originDir, { recursive: true })
    await mkdir(decodedDir, { recursive: true })
    const scrambleId = await this.client.requestScrambleId(photo.id, signal)
    const splitNumbers = photo.getSplitNumbers(scrambleId)
    await limitAll(photo.images.map((image) => async () => {
      signal?.throwIfAborted()
      const originPath = join(originDir, sanitizeFileName(image))
      if (await isNonEmptyFile(originPath)) return
      const data = await this.client.downloadImage(photo.id, image, signal)
      signal?.throwIfAborted()
      if (!data.byteLength) throw new ArtifactError(`图片为空：${photo.id}/${image}`)
      const temporaryPath = `${originPath}.part`
      await writeFile(temporaryPath, data)
      await rename(temporaryPath, originPath)
    }), this.config.concurrentDownloadLimit)
    await limitAll(photo.images.map((image, index) => async () => {
      signal?.throwIfAborted()
      await decodeImage(await readFile(join(originDir, sanitizeFileName(image))), splitNumbers[index], join(decodedDir, sanitizeFileName(image)))
    }), this.config.concurrentDecodeLimit)
    if (this.config.debug) this.logger.info('Chapter decoded: %s', photo.id)
  }

  private async ensureFreeDiskSpace() {
    if (this.config.minimumFreeDiskMb <= 0) return
    await mkdir(this.root, { recursive: true })
    const stats = await statfs(this.root)
    const freeMb = Number(stats.bavail) * Number(stats.bsize) / 1024 / 1024
    if (freeMb < this.config.minimumFreeDiskMb) throw new ArtifactError(`可用磁盘空间不足：当前约 ${Math.floor(freeMb)} MB，至少需要 ${this.config.minimumFreeDiskMb} MB`)
  }
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    return stats.isFile() && stats.size > 0
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
