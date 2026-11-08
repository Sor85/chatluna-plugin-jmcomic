#!/usr/bin/env node
// 在 v2 根目录执行：node --import @oxc-node/core/register external/jmcomic/scripts/test-sandbox.mjs
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const host = resolve(process.env.CHATLUNA_V2_ROOT ?? join(fileURLToPath(new URL('.', import.meta.url)), '../../..'))
const root = process.env.JMCOMIC_TEST_REPORT_DIR ?? await mkdtemp(join(tmpdir(), 'jmcomic-sandbox-'))
const require = createRequire(`${host}/package.json`)
const load = (name) => import(require.resolve(name))
const { App, captureLogs } = await import(`${host}/external/onebot-sandbox/tests/helpers/app.ts`)
const { SandboxControlService, SandboxRuntimeBotRegistry } = await import(`${host}/external/onebot-sandbox/src/control-service.ts`)
const { SandboxMcpService } = await import(`${host}/external/onebot-sandbox/src/mcp/service.ts`)
const { SandboxTestEndpointServer } = await import(`${host}/external/onebot-sandbox/src/mcp/server.ts`)
const { SandboxTestSpaceService } = await import(`${host}/external/onebot-sandbox/src/test-spaces.ts`)
const { default: Permissions } = await load('@chatluna/permission')
const { default: Tools } = await load('@chatluna/tool')
const { ChatService } = await load('@chatluna/chat')
const { default: Server } = await load('@cordisjs/plugin-server')
const plugin = await import(`${host}/external/jmcomic/lib/index.js`)
const { createFixture } = await import(`${host}/external/jmcomic/tests/support/fixture.ts`)

await mkdir(`${root}/runtime`, { recursive: true })
const fixture = await createFixture()
const app = new App()
app.baseDir = `${root}/runtime`
const logs = captureLogs(app)
await app.ready()
await app.plugin(Permissions, {})
await app.plugin(Tools, {})
await app.plugin(Server, { host: '127.0.0.1', port: 0 })
const origin = `http://127.0.0.1:${app.server._http.address().port}`
app.provide('http', (url, options) => fixture.request(url, {
  method: options.method, headers: options.headers, body: options.data, signal: options.signal
}))
const files = new Map()
app.provide('chatluna_storage', {
  async createTempFile(buffer, filename, options = {}) {
    const id = createHash('sha256').update(buffer).digest('hex')
    const info = { id, name: filename, type: options.mimeType ?? 'application/octet-stream', size: buffer.length }
    files.set(id, { ...info, buffer })
    return info
  },
  async readFile(id) { return files.get(id) ?? null },
  async getTempFile(id) { return files.get(id) ?? null },
  async localPath() { return undefined }
})
// 仅缩小 Agent/模型依赖；bind、send、媒体处理仍走原生 ChatService。
class SendingChat extends ChatService { static inject = ['satori'] }
await app.plugin(SendingChat, { inlineLimit: 5 * 1024 * 1024 })
const sessions = new Map()
app.on('message', (session) => {
  sessions.set(`${session.selfId}:${session.channelId}`, session)
  app.chat.bind(session.route.id, session)
})
app.middleware(() => {})
const runtimeBots = new SandboxRuntimeBotRegistry()
const control = new SandboxControlService(app, { mediaDirectory: `${root}/runtime/media`, runtimeBots })
const spaces = new SandboxTestSpaceService(app, runtimeBots)
const sandbox = new SandboxMcpService(app, control, {
  dataDirectory: `${root}/runtime`, testSpaces: spaces,
  readPerMinute: 10000, mutationPerMinute: 10000, waitPerMinute: 10000,
  maxConcurrentMutations: 20, maxConcurrentWaits: 20, eventLimit: 10000, callRecordLimit: 500
})
const credential = sandbox.createCredential('JMComic 隔离矩阵', ['read', 'interact', 'manage', 'debug'])
const endpoint = new SandboxTestEndpointServer(app, sandbox, {
  host: '127.0.0.1', port: 0, allowedSources: ['127.0.0.0/8', '::1/128'], allowedOrigins: [],
  mcp: { enabled: false, path: '/mcp' }, http: { enabled: true, path: '/api' }
})
await endpoint.start()
await app.start()
const api = `http://127.0.0.1:${endpoint.getAddress().port}/api/v1/tools/`
let spaceId, fiber, serial = 0
const results = []
const call = async (name, args = {}) => {
  const response = await fetch(`${api}${name}`, {
    method: 'POST', headers: { Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId, testRunId: 'jmcomic-matrix', ...args }), signal: AbortSignal.timeout(30000)
  })
  const data = await response.json()
  assert(response.ok, `${name}: ${response.status} ${JSON.stringify(data)}`)
  return data
}
async function configure(options = {}) {
  await fiber?.dispose()
  fiber = await app.plugin(plugin, plugin.Config.parse({ minimumFreeDiskMb: 0, retryCount: 1, publicBaseUrl: origin, ...options }))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
async function execute(bot, conversationId, toolName, args) {
  const incoming = await call('send_message', { operatorId: '71001', conversationId, content: `JMComic 中性测试 ${++serial}`, idempotencyKey: `incoming-${serial}` })
  const channel = conversationId.startsWith('group:') ? conversationId.slice(6) : 'private:71001'
  const session = sessions.get(`${bot.id}:${channel}`)
  assert(session, '沙盒消息未产生 Satori Session')
  const before = spaces.getControl(spaceId).getSnapshot().messages.length
  const tool = await app.tools.execute({ name: toolName, routeId: session.route.id, args })
  const replies = spaces.getControl(spaceId).getSnapshot().messages.slice(before).filter((message) => message.authorId === bot.id)
  return { incoming, tool, replies }
}
try {
  const created = await call('create_test_space', { name: 'JMComic 三实现完整矩阵', idempotencyKey: 'create' })
  spaceId = created.spaceId
  const bots = ['napcat', 'llbot', 'snowluma'].map((implementation, index) => ({ id: String(72001 + index), implementation }))
  const changes = [{ action: 'create-user', data: { id: '71001', name: 'JMComic 测试用户' } }]
  for (const [index, bot] of bots.entries()) changes.push(
    { action: 'create-bot', data: { ...bot, name: `测试 ${bot.implementation}` } },
    { action: 'create-group', data: { id: String(73001 + index), name: 'JMComic 测试群', members: [{ participantId: '71001', role: 'owner' }, { participantId: bot.id, role: 'member' }] } },
    { action: 'set-friendship', data: { firstId: '71001', secondId: bot.id, enabled: true } }
  )
  await call('apply_environment_changes', { expectedRevision: created.revision, changes, idempotencyKey: 'entities' })
  const conversations = await call('list_conversations', { operatorId: '71001' })
  for (const fileMethod of ['buffer', 'file', 'url']) {
    await configure({ fileMethod })
    for (const [index, bot] of bots.entries()) {
      const direct = conversations.items.find((item) => item.kind === 'private' && item.participantIds?.includes(bot.id))
        ?? conversations.items.find((item) => item.id?.startsWith('private:') && item.id.split(':').includes(bot.id))
      assert(direct, 'Missing private conversation')
      for (const conversationId of [`group:${73001 + index}`, direct.id]) {
        if (fileMethod === 'buffer') for (const [name, args] of [
          ['jmcomic_search', { query: '测试', limit: 2 }], ['jmcomic_browse', { category: '3d', time: 'week' }], ['jmcomic_info', { albumId: '100' }]
        ]) {
          const run = await execute(bot, conversationId, name, args)
          assert.equal(run.tool.ok, true, JSON.stringify(run.tool))
          assert.equal(run.tool.value.ok, true)
          assert.equal(run.replies.length, 0)
          results.push({ implementation: bot.implementation, conversationId, tool: name, ok: true })
        }
        for (const format of ['pdf', 'zip']) for (const password of ['', 'matrix-test-pass']) {
          const run = await execute(bot, conversationId, 'jmcomic_download', { albumId: '100', format, password })
          assert.equal(run.tool.ok, true, JSON.stringify(run.tool))
          if (fileMethod === 'file') {
            // 沙盒故意禁止本地文件读取；保持真实适配器的路径契约，不削弱沙盒边界。
            assert.equal(run.tool.value.ok, false)
            assert.match(run.tool.value.error, /不支持的媒体来源：file:\/\//)
            assert.match(run.tool.value.error, new RegExp(`\\.${format}$`))
            assert.equal(run.replies.length, 0)
            results.push({ implementation: bot.implementation, conversationId, fileMethod, format, encrypted: Boolean(password), outcome: 'sandbox-local-file-denied', ok: true })
            continue
          }
          assert.equal(run.tool.value.ok, true, JSON.stringify(run.tool))
          assert.equal(run.tool.value.status, 'completed')
          if (fileMethod === 'url') {
            assert.equal(run.replies.length, 0)
            const response = await fetch(run.tool.value.fileUrl)
            assert.equal(response.status, 200)
            const bytes = Buffer.from(await response.arrayBuffer())
            assert.equal(bytes.subarray(0, format === 'pdf' ? 5 : 2).toString(), format === 'pdf' ? '%PDF-' : 'PK')
            if (password && format === 'pdf') assert(bytes.toString('latin1').includes('/Encrypt'))
            if (password && format === 'zip') assert.equal(bytes.readUInt16LE(8), 99)
          } else {
            assert.equal(run.replies.length, 1, JSON.stringify(run))
            assert.equal(run.replies[0].conversationId, conversationId)
            assert(run.replies[0].media.length > 0, 'Missing file media')
            const action = await call('wait_for_onebot_action', { cursor: run.incoming.cursorBefore, botId: bot.id, action: conversationId.startsWith('group:') ? 'send_group_msg' : 'send_private_msg', status: 'success', timeoutSeconds: 5 })
            assert.equal(action.outcome, 'matched')
            assert.match(JSON.stringify(action), new RegExp(`\\.${format}`))
            assert.match(JSON.stringify(action), fileMethod === 'file' ? /file:\/\// : /base64/)
          }
          results.push({ implementation: bot.implementation, conversationId, fileMethod, format, encrypted: Boolean(password), ok: true })
        }
      }
    }
  }
  for (const failure of ['empty-image', 'invalid-image', 'no-pages']) {
    await configure({ cache: false })
    fixture.state.failure = failure
    const run = await execute(bots[0], 'group:73001', 'jmcomic_download', { albumId: '200' })
    assert.equal(run.tool.ok, true, JSON.stringify(run.tool))
    assert.equal(run.tool.value.ok, false)
    assert.equal(run.replies.length, 0)
    results.push({ failure, ok: true })
  }
  fixture.state.failure = ''
  await configure()
  const batch = await execute(bots[0], 'group:73001', 'jmcomic_download', { albumIds: ['100', '100', '404', '200'], format: 'zip' })
  assert.equal(batch.tool.value.ok, false)
  assert.equal(batch.tool.value.results.length, 3)
  assert.equal(batch.replies.length, 2)
  results.push({ mode: 'batch-dedup-partial-failure', ok: true })
  await call('complete_test_space', { idempotencyKey: 'complete' })
  await writeFile(`${root}/scene.json`, JSON.stringify(spaces.getControl(spaceId).getSnapshot(), null, 2))
  console.log(`OneBot 沙盒矩阵完成 ${results.length} 项，其中 ${results.filter((item) => item.outcome === 'sandbox-local-file-denied').length} 项为本地文件预期拒绝；报告：${root}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
  if (spaceId) await call('fail_test_space', { idempotencyKey: 'fail' }).catch(() => {})
} finally {
  await writeFile(`${root}/results.json`, JSON.stringify({ spaceId, results, requests: fixture.records.length, logs: logs.printed }, null, 2))
  await fiber?.dispose()
  await endpoint.stop()
  await app.stop()
  await fixture.close()
}
