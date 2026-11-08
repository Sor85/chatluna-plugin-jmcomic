import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'
import { httpFetch } from '@chatluna/utils'
import type {} from '@cordisjs/plugin-http'
import type {} from '@chatluna/ui-server'
import { Config } from './config'
import { JmClient } from './jm/client'
import { JmHttp } from './jm/http'
import { JmService } from './service'
import { registerTools } from './tools'

export const name = 'chatluna-jmcomic'
export { Config }
export const inject = ['http', 'tools', 'chat']

export function apply(ctx: Context, config: Config) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())
  const http = new JmHttp({ fetch: httpFetch(ctx.http), logger: ctx.logger, config, signal: lifetime.signal })
  const root = join(ctx.baseUrl ? fileURLToPath(new URL('.', ctx.baseUrl)) : process.cwd(), 'data/chatluna/jmcomic')
  const service = new JmService(ctx, config, new JmClient(http), root)
  registerTools(ctx, config, service, lifetime.signal)
  ctx.inject(['chatluna_webui'], (ctx) => {
    ctx.chatluna_webui.addEntry({ baseUrl: import.meta.url, source: '../client/index.ts', bundle: '../dist/client.js' })
  })
}
