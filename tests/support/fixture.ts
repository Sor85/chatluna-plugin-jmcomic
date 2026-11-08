import { createServer } from 'node:http'
import sharp from 'sharp'
import { encryptJmJson, encodeDomainServerResponse } from './jm-crypto'

export async function createFixture() {
  const image = await sharp({ create: { width: 20, height: 25, channels: 3, background: '#9cb7d8' } }).png().toBuffer()
  const records: Array<{ path: string; method: string; host: string; params: Record<string, string> }> = []
  const state = { failure: '', failedRequests: 0 }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.test')
    const target = new URL(url.searchParams.get('target') ?? 'https://fixture.test/')
    records.push({ path: target.pathname, method: req.method ?? '', host: target.host, params: Object.fromEntries(target.searchParams) })
    if (state.failure === 'hang') return
    if (state.failure === 'http' || (state.failedRequests-- > 0)) { res.writeHead(503); res.end('Unavailable'); return }
    if (target.pathname.startsWith('/newsvr')) { res.end(encodeDomainServerResponse({ Server: ['new.fixture.test'] })); return }
    if (state.failure === 'old-hosts' && target.hostname !== 'new.fixture.test') { res.writeHead(503); res.end(); return }
    if (target.pathname.startsWith('/media/')) {
      res.setHeader('Content-Type', 'image/png')
      res.end(state.failure === 'empty-image' ? Buffer.alloc(0) : state.failure === 'invalid-image' ? Buffer.from('invalid') : image)
      return
    }
    if (target.pathname === '/chapter_view_template') { res.end('var scramble_id = 999999;'); return }
    const timestamp = String(req.headers['tokenparam']).split(',')[0]
    const id = target.searchParams.get('id') ?? '100'
    const data = target.pathname === '/album' ? {
      id: Number(id), name: id === '404' ? '' : `测试图册${id}`, images: [], addtime: '2026-11-08', description: '中性测试图册',
      total_views: '100', likes: '20', author: ['测试作者'], tags: ['测试'], actors: [],
      series: id === '100' ? [{ id: '101', name: '章节一', sort: '1' }, { id: '102', name: '章节二', sort: '2' }] : []
    } : target.pathname === '/chapter' ? {
      id: Number(id), name: '测试章节', images: state.failure === 'no-pages' ? [] : ['0001.png', '0002.png'], image_ids: [], series: [], tags: '',
      addtime: '2026-11-08', series_id: '100', is_favorite: false, liked: false, scramble_id: 999999
    } : {
      search_query: target.searchParams.get('search_query') ?? '', total: state.failure === 'empty-search' ? '0' : '25',
      content: state.failure === 'empty-search' ? [] : Array.from({ length: 25 }, (_, index) => ({
        id: String(100 + index), name: `测试图册${index}`, author: '测试作者', description: '测试说明', image: '',
        category: { id: 'single', title: '单行本' }, category_sub: { id: '0', title: null }
      }))
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: 200, data: encryptJmJson(data, timestamp) }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind')
  const origin = `http://127.0.0.1:${address.port}`
  const request: typeof fetch = (input, init) => fetch(`${origin}/proxy?target=${encodeURIComponent(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)}`, init)
  return { image, records, state, request, origin, close: async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  } }
}
