import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHost } from './support/host'
import { Config } from '../src/config'
import { downloadArgs } from '../src/tools'

let app: Awaited<ReturnType<typeof createHost>> | undefined
afterEach(async () => { await app?.close(); app = undefined })

describe('v2 原生工具', () => {
  it('搜索、分类与详情保留原有结果', async () => {
    app = await createHost()
    const search = await app.execute('jmcomic_search', { query: '测试', limit: 3 })
    expect(search).toMatchObject({ ok: true, value: { ok: true, query: '测试', total: 25, results: expect.any(Array) } })
    if (search.ok && search.value && typeof search.value === 'object' && 'results' in search.value) expect(search.value.results).toHaveLength(3)
    expect(await app.execute('jmcomic_browse', { category: 'cosplay', time: 'week', orderBy: 'view', page: 2 })).toMatchObject({ ok: true, value: { params: { category: 'cosplay', time: 'week', orderBy: 'view' }, page: 2 } })
    expect(app.fixture.records.find((record) => record.path === '/categories/filter')?.params).toEqual({ page: '2', order: '', c: 'doujin_cosplay', o: 'mv_w' })
    expect(await app.execute('jmcomic_info', { albumId: '100' })).toMatchObject({ ok: true, value: { photoCount: 2, chapters: [{ id: '101', pageCount: 2 }, { id: '102', pageCount: 2 }], authors: ['测试作者'] } })
    expect(app.sent).toHaveLength(0)
  })
  it('普通 PDF 与加密 ZIP 真正生成并发送', async () => {
    app = await createHost()
    expect(await app.execute('jmcomic_download', { albumId: '100' })).toMatchObject({ ok: true, value: { ok: true, status: 'completed', albumId: '100', fileUrl: null } })
    const first = app.service.queue.list()[0].result
    expect(first).toBeDefined()
    expect((await readFile(first!.filePath)).subarray(0, 5).toString()).toBe('%PDF-')
    expect(await app.execute('jmcomic_download', { albumId: '100', format: 'zip', password: 'test-pass' })).toMatchObject({ ok: true, value: { ok: true, password: 'test-pass' } })
    const zip = await readFile(app.service.queue.list()[1].result!.filePath)
    expect(zip.subarray(0, 2).toString()).toBe('PK')
    expect(zip.readUInt16LE(8)).toBe(99)
    expect(app.sent).toHaveLength(2)
    expect(app.fixture.records.filter((record) => record.path.startsWith('/media/'))).toHaveLength(4)
  })
  it('同本重导出不会覆盖旧产物，批量去重保留部分失败', async () => {
    app = await createHost({ concurrentTaskLimit: 3 })
    const batch = await app.execute('jmcomic_download', { albumId: '100', albumIds: ['100', '404', '200'], format: 'zip' })
    expect(batch).toMatchObject({ ok: true, value: { ok: false, status: 'failed', taskIds: [1, 2, 3], results: [{ ok: true }, { ok: false }, { ok: true }] } })
    const before = app.service.queue.list()[0].result!
    const bytes = await readFile(before.filePath)
    await app.execute('jmcomic_download', { albumId: '100', format: 'zip', password: 'different' })
    expect(app.service.queue.list()[3].result!.filePath).not.toBe(before.filePath)
    expect(await readFile(before.filePath)).toEqual(bytes)
  })
  it('取消缓存时在发送后删除，发送错误不伪装完成', async () => {
    app = await createHost({ cache: false })
    expect(await app.execute('jmcomic_download', { albumId: '200' })).toMatchObject({ ok: true, value: { ok: true } })
    expect(await readdir(join(app.root, 'album'))).toEqual([])
    app.send.mockResolvedValueOnce({ messageIds: [] })
    expect(await app.execute('jmcomic_download', { albumId: '200' })).toMatchObject({ ok: true, value: { ok: false, error: expect.stringContaining('消息 ID') } })
  })
  it('本地文件模式保留 file URI 而不改成内联数据', async () => {
    app = await createHost({ fileMethod: 'file' })
    const result = await app.execute('jmcomic_download', { albumIds: ['200'], format: 'pdf' })
    expect(result).toMatchObject({ ok: true, value: { ok: true } })
    expect(String(app.sent[0])).toContain('file:///')
    expect(String(app.sent[0])).not.toContain('base64,')
    expect((await readFile(app.service.queue.list()[0].result!.filePath)).subarray(0, 5).toString()).toBe('%PDF-')
  })
  it('没有接收会话和 URL 服务时在下载前拒绝', async () => {
    app = await createHost()
    expect(await app.execute('jmcomic_download', { albumId: '100' }, 'missing')).toMatchObject({ ok: false })
    expect(app.fixture.records).toHaveLength(0)
    await app.close()
    app = await createHost({ fileMethod: 'url' })
    expect(await app.execute('jmcomic_download', { albumId: '100' })).toMatchObject({ ok: false })
    expect(app.fixture.records).toHaveLength(0)
  })
  it('禁止 AI 改格式时忽略额外 format，空密码覆盖默认密码', async () => {
    app = await createHost({ allowAIChangeFormat: false, password: 'default-pass' })
    expect(downloadArgs(app.config).dict).not.toHaveProperty('format')
    expect(await app.execute('jmcomic_download', { albumId: '200', format: 'zip', password: '' })).toMatchObject({ ok: true, value: { fileName: expect.stringMatching(/\.pdf$/) } })
    expect((await readFile(app.service.queue.list()[0].result!.filePath)).toString('latin1')).not.toContain('/Encrypt')
  })
  it('参数验证、页数保护和空图返回明确错误', async () => {
    app = await createHost({ maxDownloadPages: 1 })
    for (const args of [{}, { albumId: '../1' }, { albumIds: [] }, { albumId: '1', albumIds: Array.from({ length: 10 }, (_, i) => String(i + 2)) }]) {
      expect(await app.execute('jmcomic_download', args)).toMatchObject({ ok: false })
    }
    expect(await app.execute('jmcomic_search', { query: '', limit: 1.5 })).toMatchObject({ ok: false })
    expect(await app.execute('jmcomic_download', { albumId: '100' })).toMatchObject({ ok: true, value: { ok: false, error: expect.stringContaining('页数过多') } })
    expect(app.fixture.records.some((record) => record.path.startsWith('/media/'))).toBe(false)
  })
  it('调用取消与插件卸载取消网络，不再发送', async () => {
    app = await createHost()
    app.fixture.state.failure = 'hang'
    const controller = new AbortController()
    const pending = app.execute('jmcomic_download', { albumId: '100' }, 'test-route', controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort(new Error('cancel-test'))
    expect(await pending).toMatchObject({ ok: false })
    await app.service.queue.waitForIdle()
    expect(app.sent).toHaveLength(0)
    const next = app.execute('jmcomic_search', { query: 'test' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    await app.fiber.dispose()
    expect(await next).toMatchObject({ ok: false })
  })
  it('配置不包含旧工具编辑字段，默认值保持一致', () => {
    const keys = Object.keys(Config.parse({}))
    expect(keys).toHaveLength(17)
    expect(keys).not.toEqual(expect.arrayContaining(['enabledTools', 'searchTool', 'browseTool', 'infoTool', 'downloadTool']))
    expect(Config.parse({})).toMatchObject({ defaultFormat: 'pdf', fileMethod: 'buffer', retryCount: 5, minimumFreeDiskMb: 3000, maxDownloadPages: 300, concurrentDownloadLimit: 8, concurrentDecodeLimit: 4, concurrentTaskLimit: 1, cache: true, fileExpireHours: 24 })
  })
})
