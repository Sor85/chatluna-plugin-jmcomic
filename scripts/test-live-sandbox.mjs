#!/usr/bin/env node
// 共享实例接入烟测：SANDBOX_TOKEN 仅从环境读取，不获取实际站点内容。
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const token = process.env.SANDBOX_TOKEN
if (!token) throw new Error('缺少 SANDBOX_TOKEN')
const api = process.env.SANDBOX_API ?? 'http://127.0.0.1:61901/api/v1/tools/'
const root = await mkdtemp(join(tmpdir(), 'jmcomic-live-'))
const suffix = String(Date.now()).slice(-7)
const state = { runId: `jmcomic-live-${suffix}`, spaceId: undefined, userId: `61${suffix}`, botId: `62${suffix}`, groupId: `63${suffix}`, presetId: `sandbox-test-jmcomic-${suffix}` }
let presetCreated = false
const call = async (name, args = {}) => {
  const response = await fetch(`${api}${name}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId: state.spaceId, testRunId: state.runId, ...args }), signal: AbortSignal.timeout(150000)
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}: ${JSON.stringify(data)}`)
  return data
}
const evidence = []
try {
  const created = await call('create_test_space', { name: 'JMComic v2 接入验收', idempotencyKey: `${state.runId}-create` })
  state.spaceId = created.spaceId
  await writeFile(`${root}/state.json`, JSON.stringify(state, null, 2))
  await call('apply_environment_changes', { expectedRevision: created.revision, idempotencyKey: `${state.runId}-entities`, changes: [
    { action: 'create-user', data: { id: state.userId, name: 'JMComic 测试用户' } },
    { action: 'create-bot', data: { id: state.botId, name: 'JMComic 测试机器人', implementation: 'napcat' } },
    { action: 'create-group', data: { id: state.groupId, name: 'JMComic 接入测试群', members: [{ participantId: state.userId, role: 'owner' }, { participantId: state.botId, role: 'member' }] } },
    { action: 'set-friendship', data: { firstId: state.userId, secondId: state.botId, enabled: true } }
  ] })
  const initialWakeup = await call('get_wakeup_rules', { conversationId: `group:${state.groupId}`, operatorId: state.userId, botId: state.botId })
  const character = initialWakeup.scopes?.some((scope) => scope.responders?.some((responder) => responder.engine === 'character'))
  await call('create_test_preset', {
    presetId: state.presetId, loader: character ? 'character-md' : 'md',
    text: `---\n${character ? 'kind: character\n' : ''}name: JMComic工具测试\ndescription: 隔离测试，不查询实际站点\n${character ? 'nick: [JMComic测试机器人]\n' : 'tools:\n  allow: [jmcomic_search, jmcomic_browse, jmcomic_info, jmcomic_download, reply, run_code, tool_search]\n'}---\n你是插件测试机器人。执行用户明确指定的工具边界测试，不自行修正测试输入，不补充图册ID。只调用 jmcomic_download，参数为空对象。这会在本地返回缺失ID错误，不访问外网。调用后用一句中文报告错误；禁止调用搜索、浏览、详情，禁止实际下载。若工具通过 run_code 提供，调用 tools.jmcomic_download({})，不要用口头描述代替调用。\n`
  })
  presetCreated = true
  await call('set_bot_preset', { botId: state.botId, presetId: state.presetId })
  const conversations = await call('list_conversations', { operatorId: state.userId })
  const direct = conversations.items.find((item) => item.id?.startsWith('private:') && item.id.split(':').includes(state.botId))
  assert(direct, '没有创建私聊')
  for (const conversationId of [`group:${state.groupId}`, direct.id]) {
    const wakeup = await call('get_wakeup_rules', { conversationId, operatorId: state.userId, botId: state.botId })
    await writeFile(`${root}/wakeup-${conversationId.startsWith('group:') ? 'group' : 'private'}.json`, JSON.stringify(wakeup, null, 2))
    const sent = await call('send_message', {
      operatorId: state.userId, conversationId,
      content: `<at id="${state.botId}"/> 执行缺失ID边界测试：现在实际调用 jmcomic_download，参数为空对象 {}，不要补入任何ID。收到错误后原样报告错误，不调用其他业务工具。`,
      idempotencyKey: `${state.runId}-${conversationId}`
    })
    const wait = await call('wait_for_message', { cursor: sent.cursorBefore, conversationId, authorId: state.botId, settleSeconds: 3, timeoutSeconds: 120 })
    const calls = await call('list_model_calls', { conversationId, botId: state.botId, limit: 20 })
    const conversation = await call('get_conversation', { conversationId, operatorId: state.userId, messageLimit: 20 })
    evidence.push({ conversationId, wait, calls, conversation })
    await writeFile(`${root}/evidence.json`, JSON.stringify(evidence, null, 2))
    const directCall = calls.calls?.some((item) => item.toolCalls?.includes('jmcomic_download'))
    let codeCall = false
    if (!directCall) for (const item of calls.calls ?? []) {
      if (!item.toolCalls?.includes('run_code')) continue
      const detail = await call('get_model_call', { sessionId: calls.sessionId, seq: item.seq })
      codeCall ||= detail.response?.content?.some((block) => block.type === 'tool-call' && block.toolName === 'run_code' && JSON.stringify(block).includes('jmcomic_download'))
    }
    assert(directCall || codeCall, '模型调用记录没有实际的 JMComic 工具调用')
    assert.match(JSON.stringify(conversation), /albumId|albumIds|至少需要提供/, '未收到缺失 ID 的工具结果')
  }
  await call('complete_test_space', { idempotencyKey: `${state.runId}-complete` })
  console.log(JSON.stringify({ ok: true, spaceId: state.spaceId, cases: evidence.length, report: root }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
  if (state.spaceId) await call('fail_test_space', { idempotencyKey: `${state.runId}-fail` }).catch(() => {})
  console.log(`验收记录：${root}`)
} finally {
  if (state.spaceId) await call('set_bot_preset', { botId: state.botId }).catch((error) => console.error('测试路由清理失败', error))
  if (presetCreated) await call('delete_test_preset', { presetId: state.presetId }).catch((error) => console.error('测试预设清理失败', error))
}
