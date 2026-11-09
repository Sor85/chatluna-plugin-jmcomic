import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { Context } from 'cordis'
import { h, type Session } from '@satorijs/core'
import type { Config } from './config'
import type { JmClient } from './jm/client'
import { FileLinkService } from './file-service'
import { AlbumDownloader, type DownloadAlbumInput, type DownloadAlbumResult } from './task/downloader'
import { TaskQueue } from './task/queue'

export interface DownloadRequest extends DownloadAlbumInput {
  session?: Session
}

export class JmService {
  readonly queue: TaskQueue<DownloadRequest, DownloadAlbumResult>
  private downloader: AlbumDownloader
  private links?: FileLinkService
  private albumLocks = new Map<string, Promise<void>>()
  private pruning?: Promise<void>

  constructor(private ctx: Context, private config: Config, readonly client: JmClient, root: string) {
    this.downloader = new AlbumDownloader(root, client, config, ctx.logger)
    if (config.fileMethod === 'url') this.links = new FileLinkService(ctx, config)
    this.queue = new TaskQueue((input) => this.process(input), config.concurrentTaskLimit)
    ctx.effect(() => {
      const timer = setInterval(() => { void this.prune() }, 3600000)
      timer.unref()
      return () => {
        clearInterval(timer)
        this.queue.stop()
      }
    })
  }

  assertDelivery(session?: Session) {
    if (this.config.fileMethod === 'url') this.links?.assertAvailable()
    else if (!session?.channelId) throw new Error('JMComic 下载工具无法获取当前会话，文件未发送')
  }

  private async process(input: DownloadRequest): Promise<DownloadAlbumResult> {
    const previous = this.albumLocks.get(input.albumId) ?? Promise.resolve()
    const lock = Promise.withResolvers<void>()
    const next = previous.then(() => lock.promise)
    this.albumLocks.set(input.albumId, next)
    await previous
    try {
      // 等待清理结束后才创建新缓存，清理也会跳过所有排队中的本子。
      await this.pruning
      input.signal?.throwIfAborted()
      this.assertDelivery(input.session)
      let failed = false
      try {
        const result = await this.downloader.download(input)
        input.signal?.throwIfAborted()
        if (this.links) result.fileUrl = this.links.create(result)
        else await this.deliver(input.session!, result, input.signal)
        return result
      } catch (error) {
        failed = true
        throw error
      } finally {
        if (!this.config.cache && !this.links) {
          try {
            await this.downloader.cleanup(input.albumId)
          } catch (error) {
            if (!failed) throw error
            this.ctx.logger.warn('JM cleanup failed after task error: %s', String(error))
          }
        }
      }
    } finally {
      lock.resolve()
      if (this.albumLocks.get(input.albumId) === next) this.albumLocks.delete(input.albumId)
      void this.prune()
    }
  }

  private async deliver(session: Session, result: DownloadAlbumResult, signal?: AbortSignal) {
    const title = result.fileName
    const content = this.config.fileMethod === 'file'
      ? h.file(pathToFileURL(result.filePath).href, { title })
      : h.file(await readFile(result.filePath), result.extension === 'pdf' ? 'application/pdf' : 'application/zip', { title })
    signal?.throwIfAborted()
    // 这些文件由插件自己生成。直接走 Satori 保留 buffer/file 传输语义，
    // 避免 ChatService 将 file:// 当作 Agent 机器路径读取并重新编码。
    const messageIds = await session.bot.sendMessage(session.channelId!, content, session.event.referrer, { session })
    if (!messageIds.length) throw new Error('JMComic 文件发送失败：没有返回消息 ID')
  }

  private prune(): Promise<void> {
    return this.pruning ??= this.downloader.cleanupExpired(new Date(), new Set(this.albumLocks.keys()))
      .then(() => {
        this.queue.pruneTerminalTasks(this.config.fileExpireHours * 3600000)
        this.links?.pruneExpired()
      })
      .catch((error) => { this.ctx.logger.warn('JM expired cache cleanup failed: %s', String(error)) })
      .finally(() => { this.pruning = undefined })
  }
}
