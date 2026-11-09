import type { Context } from 'cordis'
import { Schema } from '@chatluna/schema'
import type {} from '@chatluna/chat'
import type {} from '@chatluna/tool'
import type { Config, OutputFormat } from './config'
import type { JmService } from './service'
import type { BrowseOptions } from './jm/client'
import type { JmSearchContentJson } from './jm/types'

export interface DownloadInput {
  albumId?: string
  albumIds?: string[]
  format?: OutputFormat
  password?: string
}

export function downloadArgs(config: Config): Schema<DownloadInput> {
  const shape = {
    albumId: Schema.string().pattern(/^\d+$/).optional().description('One numeric album ID. Supply albumId or albumIds.'),
    albumIds: Schema.array(Schema.string().pattern(/^\d+$/)).min(1).max(10).optional().default(undefined).description('Up to ten numeric album IDs. Duplicates are downloaded once.'),
    password: Schema.string().optional().description('Password for this export. An empty string disables the configured default password.')
  }
  return config.allowAIChangeFormat
    ? Schema.object({ ...shape, format: Schema.enum(['pdf', 'zip']).optional().description('Export format for this call; defaults to the plugin setting.') })
    : Schema.object(shape)
}

export function registerTools(ctx: Context, config: Config, service: JmService, lifetime: AbortSignal) {
  ctx.tools.define<{ query: string; limit: number }>({
    name: 'jmcomic_search',
    description: 'Search JMComic albums and return IDs, titles, authors, categories and descriptions.',
    locales: { zh: { description: '搜索 JMComic 本子，返回 ID、标题、作者、分类和简介。', args: { query: '搜索关键词。', limit: '返回条数，1–20，默认 10。' } } },
    args: Schema.object({
      query: Schema.string().min(1).required().description('Search keywords.'),
      limit: Schema.number().min(1).max(20).step(1).default(10).description('Maximum number of results.')
    }),
    traits: { effect: 'read', parallel: true, background: false, timeout: 180000 },
    async run(input, call) {
      const result = await service.client.search(input.query, AbortSignal.any([call.signal, lifetime]))
      return { ok: true, query: input.query, total: Number(result.total || 0), results: result.content.slice(0, input.limit).map(formatSearchItem) }
    }
  })
  ctx.tools.define<BrowseOptions & { limit: number }>({
    name: 'jmcomic_browse',
    description: 'Browse JMComic albums by category, time range and ordering.',
    locales: { zh: { description: '按分类、时间范围和排序方式浏览 JMComic 本子。', args: {
      page: '页码，从 1 开始。', time: '时间范围。', category: '分类。', orderBy: '排序方式。', limit: '返回条数，1–20，默认 10。'
    } } },
    args: Schema.object({
      page: Schema.number().min(1).step(1).default(1).description('Page number, starting at 1.'),
      time: Schema.enum(['today', 'week', 'month', 'all']).default('all').description('Time range.'),
      category: Schema.enum(['all', 'doujin', 'single', 'short', 'another', 'hanman', 'meiman', 'doujin_cosplay', 'cosplay', '3d', 'english_site']).default('all').description('Album category.'),
      orderBy: Schema.enum(['latest', 'view', 'picture', 'like', 'month_rank', 'week_rank', 'day_rank']).default('latest').description('Sort order.'),
      limit: Schema.number().min(1).max(20).step(1).default(10).description('Maximum number of results.')
    }),
    traits: { effect: 'read', parallel: true, background: false, timeout: 180000 },
    async run(input, call) {
      const result = await service.client.browse(input, AbortSignal.any([call.signal, lifetime]))
      return { ok: true, page: input.page, total: Number(result.total || 0), params: { time: input.time, category: input.category, orderBy: input.orderBy }, results: result.content.slice(0, input.limit).map(formatSearchItem) }
    }
  })
  ctx.tools.define<{ albumId: string }>({
    name: 'jmcomic_info',
    description: 'Get JMComic album details including chapters, page counts, tags, authors and view counts.',
    locales: { zh: { description: '根据 JMComic 本子 ID 查询详情。', args: { albumId: '数字本子 ID。' } } },
    args: Schema.object({ albumId: Schema.string().pattern(/^\d+$/).required().description('Numeric album ID.') }),
    traits: { effect: 'read', parallel: true, background: false, timeout: 180000 },
    async run(input, call) {
      const album = await service.client.getAlbumById(input.albumId, AbortSignal.any([call.signal, lifetime]))
      return {
        ok: true, id: album.id, title: album.name, description: album.description, cover: album.cover,
        publishedAt: album.publishedAt, authors: album.authors, tags: album.tags, actors: album.actors,
        photoCount: album.photos.length,
        chapters: album.series.map((chapter) => ({ id: String(chapter.id), title: chapter.name, sort: chapter.sort, pageCount: album.photos.find((photo) => photo.id === String(chapter.id))?.images.length ?? null })),
        likes: album.likes, totalViews: album.totalViews
      }
    }
  })
  ctx.tools.define({
    name: 'jmcomic_download',
    description: 'Download one or more JMComic albums as PDF or ZIP. Waits for completion, then sends files to the current conversation or returns download links according to plugin settings.',
    locales: { zh: { description: '将一个或多个 JMComic 本子下载为 PDF 或 ZIP，任务完成后按配置发送文件或生成链接。', args: {
      albumId: '单个数字本子 ID；与 albumIds 至少提供一个。', albumIds: '最多 10 个本子 ID，重复 ID 只下载一次。', password: '本次导出密码；空字符串表示不加密。', format: '本次导出格式，省略时使用插件默认值。'
    } } },
    args: downloadArgs(config),
    traits: { effect: 'write', parallel: false, background: false, timeout: 900000 },
    async run(input, call) {
      const signal = AbortSignal.any([call.signal, lifetime])
      signal.throwIfAborted()
      const albumIds = [...new Set([...(input.albumId ? [input.albumId] : []), ...(input.albumIds ?? [])])]
      if (!albumIds.length) throw new Error('albumId 或 albumIds 至少需要提供一个')
      if (albumIds.length > 10) throw new Error('单次最多下载 10 个本子')
      const session = call.routeId ? ctx.chat.inbound(call.routeId) : undefined
      service.assertDelivery(session)
      const format = config.allowAIChangeFormat ? input.format ?? config.defaultFormat : config.defaultFormat
      const password = input.password ?? config.password
      const tasks = albumIds.map((albumId) => ({ albumId, taskId: service.queue.add({ albumId, format, password, session, signal }) }))
      const results = await Promise.all(tasks.map(async (added) => {
        const task = await service.queue.waitForTask(added.taskId)
        if (task?.status === 'completed' && task.result) {
          return {
            ok: true, taskId: task.id, status: 'completed', albumId: task.result.albumId, title: task.result.title,
            fileName: task.result.fileName,
            fileUrl: task.result.fileUrl ?? null, ...(password ? { password } : {})
          }
        }
        return { ok: false, taskId: added.taskId, status: 'failed', albumId: added.albumId, error: task?.error ?? '任务不存在' }
      }))
      signal.throwIfAborted()
      return results.length === 1 ? results[0] : {
        ok: results.every((result) => result.ok), status: results.every((result) => result.ok) ? 'completed' : 'failed', taskIds: tasks.map((task) => task.taskId), results
      }
    }
  })
}

function formatSearchItem(item: JmSearchContentJson) {
  return { id: item.id, title: item.name, author: item.author, category: item.category?.title, description: item.description }
}
