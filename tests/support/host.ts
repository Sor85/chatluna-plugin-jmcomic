import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import { Satori, Session, type Fragment } from '@satorijs/core'
import Permissions from '@chatluna/permission'
import Tools from '@chatluna/tool'
import type { JsonValue } from '@chatluna/message'
import { vi } from 'vitest'
import { Config } from '../../src/config'
import { JmHttp } from '../../src/jm/http'
import { JmClient } from '../../src/jm/client'
import { JmService } from '../../src/service'
import { registerTools } from '../../src/tools'
import { createFixture } from './fixture'

export async function createHost(overrides: Partial<Config> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jmcomic-unit-'))
  const fixture = await createFixture()
  const ctx = new Context()
  await ctx.plugin(Satori)
  await ctx.plugin(Permissions, {})
  await ctx.plugin(Tools, {})
  const config = Config.parse({ minimumFreeDiskMb: 0, retryCount: 1, ...overrides })
  const sent: Fragment[] = []
  const send = vi.fn(async (_route: unknown, content: Fragment) => { sent.push(content); return { messageIds: ['sent'] } })
  const bot = { ctx, platform: 'onebot', selfId: '90001', user: { id: '90001' }, logger: ctx.logger,
    sendMessage: async (_channel: string, content: Fragment) => (await send(_channel, content)).messageIds
  }
  const session = new Session(bot, { type: 'message', platform: 'onebot', selfId: '90001', user: { id: '90002' }, channel: { id: '90003', type: 0 }, guild: { id: '90003' }, message: { id: '1' } })
  ctx.provide('chat', { inbound: (routeId: string) => routeId === 'test-route' ? session : undefined, send })
  const lifetime = new AbortController()
  const client = new JmClient(new JmHttp({ fetch: fixture.request, config, signal: lifetime.signal, logger: ctx.logger }))
  const ready = Promise.withResolvers<JmService>()
  const fiber = await ctx.plugin({ inject: ['tools', 'chat'], apply(ctx: Context) {
    ctx.effect(() => () => lifetime.abort())
    const service = new JmService(ctx, config, client, root)
    registerTools(ctx, config, service, lifetime.signal)
    ready.resolve(service)
  } })
  const service = await ready.promise
  return { root, fixture, ctx, config, client, service, lifetime, fiber, sent, send, session,
    execute: (name: string, args: JsonValue, routeId: string | undefined = 'test-route', signal?: AbortSignal) => ctx.tools.execute({ name, args, routeId, signal }),
    close: async () => { await ctx.fiber.dispose(); await service.queue.waitForIdle(); await fixture.close(); await rm(root, { recursive: true, force: true }) }
  }
}
