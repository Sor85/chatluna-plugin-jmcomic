import { Context } from 'cordis'
import Server from '@cordisjs/plugin-server'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Config } from '../src/config'
import { FileLinkService, FILE_ROUTE } from '../src/file-service'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function host() {
  const ctx = new Context()
  const root = await mkdtemp(join(tmpdir(), 'jmcomic-files-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }), () => ctx.fiber.dispose())
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  const address = ctx.server._http.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  const origin = `http://127.0.0.1:${address.port}`
  const ready = Promise.withResolvers<FileLinkService>()
  const fiber = await ctx.plugin((ctx) => ready.resolve(new FileLinkService(ctx, Config.parse({ fileMethod: 'url', publicBaseUrl: origin, filterSensitiveFileName: true }))))
  const service = await ready.promise
  await new Promise((resolve) => setTimeout(resolve, 0))
  const filePath = join(root, 'test.pdf')
  await writeFile(filePath, '%PDF-test')
  const result = { albumId: '100', title: '测试图册', filePath, fileName: '测试图册.pdf', extension: 'pdf' } satisfies Parameters<FileLinkService['create']>[0]
  return { service, result, origin, fiber }
}

describe('v2 文件链接', () => {
  it('真实 HTTP 下载、附件名、有效期、缺失文件与卸载', async () => {
    const app = await host()
    const url = app.service.create(app.result)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''")
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(app.result.filePath))
    expect((await fetch(`${app.origin}${FILE_ROUTE}/unknown`)).status).toBe(404)
    const expired = app.service.create(app.result, new Date(Date.now() - 25 * 3600000))
    expect((await fetch(expired)).status).toBe(404)
    await rm(app.result.filePath)
    expect((await fetch(url)).status).toBe(404)
    await app.fiber.dispose()
    expect(() => app.service.create(app.result)).toThrow('server')
    expect((await fetch(url)).status).toBe(404)
  })
})
