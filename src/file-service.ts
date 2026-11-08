import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { Context } from 'cordis'
import type {} from '@cordisjs/plugin-server'
import type { Config } from './config'
import type { DownloadAlbumResult } from './task/downloader'
import { filterSensitiveFileName } from './utils/file'

export const FILE_ROUTE = '/chatluna-jmcomic/files'

export class FileLinkService {
  private records = new Map<string, { result: DownloadAlbumResult; expiresAt: number }>()
  private baseUrl?: string

  constructor(ctx: Context, private config: Config) {
    ctx.inject(['server'], (ctx) => {
      const base = config.publicBaseUrl.trim() || ctx.server.baseUrl
      try {
        const url = new URL(base)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid URL')
        this.baseUrl = url.href.replace(/\/+$/, '')
      } catch {
        ctx.logger.warn('Invalid JMComic public base URL')
      }
      ctx.server.get(`${FILE_ROUTE}/:token`, (request) => this.download(request.params.token))
      ctx.effect(() => () => {
        this.baseUrl = undefined
        this.records.clear()
      })
    })
  }

  assertAvailable() {
    if (!this.baseUrl) throw new Error('URL 文件链接需要启用 server 并配置 publicBaseUrl 或 server.baseUrl')
  }

  create(result: DownloadAlbumResult, now = new Date()) {
    this.assertAvailable()
    const token = randomUUID()
    this.records.set(token, { result, expiresAt: now.getTime() + this.config.fileExpireHours * 3600000 })
    return `${this.baseUrl}${FILE_ROUTE}/${token}`
  }

  pruneExpired(now = new Date()) {
    for (const [token, record] of this.records) if (record.expiresAt <= now.getTime()) this.records.delete(token)
  }

  async download(token: string): Promise<Response> {
    const record = this.records.get(token)
    if (!record || record.expiresAt <= Date.now()) {
      this.records.delete(token)
      return new Response('Not found', { status: 404 })
    }
    let file
    try {
      file = await open(record.result.filePath, 'r')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.records.delete(token)
      return new Response('Not found', { status: 404 })
    }
    const fileName = this.config.filterSensitiveFileName ? filterSensitiveFileName(record.result.fileName) : record.result.fileName
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const buffer = new Uint8Array(65536)
          const { bytesRead } = await file.read(buffer)
          if (bytesRead) controller.enqueue(buffer.subarray(0, bytesRead))
          else {
            controller.close()
            await file.close()
          }
        } catch (error) {
          controller.error(error)
          await file.close()
        }
      },
      async cancel() { await file.close() }
    })
    return new Response(stream, {
      headers: {
        'Content-Type': record.result.extension === 'pdf' ? 'application/pdf' : 'application/zip',
        'Content-Disposition': `attachment; filename="download.${record.result.extension}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  }
}
