import { mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHost } from '../support/host'
import { AlbumDownloader } from '../../src/task/downloader'
import { TaskQueue } from '../../src/task/queue'
import { limitAll } from '../../src/utils/limit'

let app: Awaited<ReturnType<typeof createHost>> | undefined
afterEach(async () => { await app?.close(); app = undefined })

describe('任务生命周期', () => {
  it('同本并发下载串行且产物独立', async () => {
    app = await createHost({ concurrentTaskLimit: 3 })
    const results = await Promise.all([
      app.execute('jmcomic_download', { albumId: '100', format: 'pdf' }),
      app.execute('jmcomic_download', { albumId: '100', format: 'zip' }),
      app.execute('jmcomic_download', { albumId: '100', format: 'pdf', password: 'encrypted' })
    ])
    for (const result of results) expect(result).toMatchObject({ ok: true, value: { ok: true } })
    const paths = app.service.queue.list().map((task) => task.result!.filePath)
    expect(new Set(paths).size).toBe(3)
    expect((await readFile(paths[0])).toString('latin1')).not.toContain('/Encrypt')
    expect((await readFile(paths[2])).toString('latin1')).toContain('/Encrypt')
    expect(app.fixture.records.filter((record) => record.path.startsWith('/media/'))).toHaveLength(4)
  })
  it('过期清理保留活动目录与无关数据', async () => {
    app = await createHost()
    const old = new Date(Date.now() - 48 * 3600000)
    for (const id of ['100', '200', 'unrelated']) {
      const directory = join(app.root, 'album', id)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'evidence.txt'), 'test')
      await utimes(directory, old, old)
    }
    const downloader = new AlbumDownloader(app.root, app.client, app.config, app.ctx.logger)
    await downloader.cleanupExpired(new Date(), new Set(['200']))
    expect((await readdir(join(app.root, 'album'))).sort()).toEqual(['200', 'unrelated'])
  })
  it('卸载取消待处理任务并释放等待者', async () => {
    const gate = Promise.withResolvers<void>()
    const queue = new TaskQueue(async (value: string) => { await gate.promise; return value }, 1)
    const first = queue.add('first')
    const next = queue.add('next')
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    queue.stop()
    expect(await queue.waitForTask(next)).toMatchObject({ status: 'failed', error: 'JMComic plugin unloaded' })
    expect(() => queue.add('later')).toThrow('stopped')
    gate.resolve()
    await queue.waitForIdle()
    expect(queue.get(first)?.status).toBe('completed')
  })
  it('worker 失败等待其他写入结束，不提前返回', async () => {
    const gate = Promise.withResolvers<void>()
    let finished = false
    const pending = limitAll([
      async () => { throw new Error('original') },
      async () => { await gate.promise; finished = true }
    ], 2)
    void pending.catch(() => {})
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(finished).toBe(false)
    gate.resolve()
    await expect(pending).rejects.toThrow('original')
    expect(finished).toBe(true)
  })
})
