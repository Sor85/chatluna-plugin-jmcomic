import { afterEach, describe, expect, it } from 'vitest'
import { createHost } from '../support/host'
let app: Awaited<ReturnType<typeof createHost>> | undefined
afterEach(async () => { await app?.close(); app = undefined })

describe('JM HTTP 协议与失败保护', () => {
  it('失败重试与加密域名更新', async () => {
    app = await createHost({ retryCount: 2 })
    app.fixture.state.failedRequests = 1
    expect((await app.client.search('test')).content).toHaveLength(25)
    expect(app.fixture.records).toHaveLength(2)
    app.fixture.state.failure = 'old-hosts'
    expect((await app.client.search('test')).content).toHaveLength(25)
    expect(app.fixture.records.at(-1)?.host).toBe('new.fixture.test')
  })
  it('合法空结果不等同请求失败，全部失败会报告错误', async () => {
    app = await createHost()
    app.fixture.state.failure = 'empty-search'
    expect((await app.client.search('none')).content).toEqual([])
    app.fixture.state.failure = 'http'
    await expect(app.client.search('test')).rejects.toThrow('JM request failed')
  })
  it('空图、损坏图和无页章节均不能返回完成', async () => {
    app = await createHost({ cache: false })
    for (const failure of ['empty-image', 'invalid-image', 'no-pages']) {
      app.fixture.state.failure = failure
      expect(await app.execute('jmcomic_download', { albumId: '200' })).toMatchObject({ ok: true, value: { ok: false } })
      expect(app.sent).toHaveLength(0)
    }
  })
  it('所有分类与排行榜映射保持兼容', async () => {
    app = await createHost()
    await app.client.browse({ page: 1, time: 'all', category: '3d', orderBy: 'month_rank' })
    expect(app.fixture.records.at(-1)?.params).toMatchObject({ c: '3D', o: 'mv_m' })
    await app.client.browse({ page: 3, time: 'today', category: 'all', orderBy: 'like' })
    expect(app.fixture.records.at(-1)?.params).toMatchObject({ page: '3', c: '0', o: 'tf_t' })
  })
})
