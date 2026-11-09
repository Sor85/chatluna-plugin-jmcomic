import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

interface Command { command: string; args: string[]; cwd: string }
interface State {
  dirty?: boolean
  missingOrigin?: boolean
  differentHead?: boolean
  existingTag?: boolean
  failCommand?: string
  failPublish?: boolean
  workspaceDependency?: boolean
  emptyReadme?: boolean
  version?: string
}

// 所有外部命令都由临时 PATH 中的本地桩接管，绝不连接 registry 或操作真实 Git。
async function execute(args: string[], state: State = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jmcomic-publish-test-')))
  directories.push(root)
  const source = join(root, 'source')
  const host = join(root, 'host')
  const bin = join(root, 'bin')
  const target = join(host, 'external/jmcomic')
  const log = join(root, 'commands.jsonl')
  for (const directory of [join(source, 'scripts'), join(host, 'node_modules/.bin'), join(target, 'lib'), join(target, 'dist'), bin]) {
    await mkdir(directory, { recursive: true })
  }
  const manifest = { name: 'chatluna-plugin-jmcomic', version: state.version ?? '0.0.1', devDependencies: { '@chatluna/tool': 'workspace:*' } }
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(host, 'package.json'), '{}')
  for (const entry of ['lib/stale.js', 'dist/stale.css', 'tsconfig.tsbuildinfo']) await writeFile(join(target, entry), 'stale')
  await copyFile(resolve(import.meta.dirname, '../scripts/publish.mjs'), join(source, 'scripts/publish.mjs'))
  await writeFile(join(source, 'scripts/sync-to-v2.mjs'), `
    import fs from 'node:fs'; import path from 'node:path';
    fs.appendFileSync(process.env.PUBLISH_TEST_LOG, JSON.stringify({ command: 'sync', args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
    fs.copyFileSync(path.join(process.cwd(), 'package.json'), path.join(process.env.CHATLUNA_V2_ROOT, 'external/jmcomic/package.json'));
  `)
  const stub = `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const command = path.basename(process.argv[1]); const args = process.argv.slice(2);
const state = JSON.parse(process.env.PUBLISH_TEST_STATE);
const target = path.join(process.env.CHATLUNA_V2_ROOT, 'external/jmcomic');
fs.appendFileSync(process.env.PUBLISH_TEST_LOG, JSON.stringify({ command, args, cwd: process.cwd() }) + '\\n');
if (state.failCommand === command || (state.failPublish && command === 'npm' && args[0] === 'publish')) process.exit(7);
if (command === 'git') {
  if (args[0] === 'status' && state.dirty) console.log(' M README.md');
  if (args[0] === 'branch') console.log('main');
  if (args[0] === 'remote') { if (state.missingOrigin) process.exit(2); console.log('fixture:origin'); }
  if (args[0] === 'tag' && args[1] === '--list' && state.existingTag) console.log(args[2]);
  if (args[0] === 'rev-parse') console.log(args[1] === 'HEAD' || !state.differentHead ? 'same-head' : 'different-head');
}
if (command === 'yarn' && args[0] === 'yakumo') {
  for (const entry of ['lib/stale.js', 'dist/stale.css', 'tsconfig.tsbuildinfo']) if (fs.existsSync(path.join(target, entry))) process.exit(3);
  for (const file of ['lib/index.js', 'lib/index.d.ts', 'dist/client.js', 'dist/client.css', 'client/index.ts', 'README.md', 'LICENSE']) {
    fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    fs.writeFileSync(path.join(target, file), file === 'README.md' && state.emptyReadme ? '' : 'fixture');
  }
}
if (command === 'yarn' && args[0] === 'pack') fs.writeFileSync(args[2], 'fixture tarball');
if (command === 'tar') {
  const dest = path.join(args[3], 'package'); fs.cpSync(target, dest, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
  if (!state.workspaceDependency) manifest.devDependencies['@chatluna/tool'] = '2.0.0-alpha.0';
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(manifest));
}
if (command === 'npm' && args[0] === 'whoami') console.log('fixture-user');
if (command === 'npm' && args[0] === 'view') console.log(JSON.stringify(state.version || '0.0.1'));
`
  for (const name of ['git', 'npm', 'yarn', 'tar']) {
    await writeFile(join(bin, name), stub)
    await chmod(join(bin, name), 0o755)
  }
  for (const name of ['vitest', 'tsc']) {
    await writeFile(join(host, 'node_modules/.bin', name), stub)
    await chmod(join(host, 'node_modules/.bin', name), 0o755)
  }
  const result = spawnSync(process.execPath, [join(source, 'scripts/publish.mjs'), ...args], {
    cwd: source, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: bin, TMPDIR: root, TMP: root, TEMP: root, CHATLUNA_V2_ROOT: host, PUBLISH_TEST_LOG: log, PUBLISH_TEST_STATE: JSON.stringify(state) },
  })
  const records = await readFile(log, 'utf8').catch(() => '')
  const commands: Command[] = records.trim() ? records.trim().split('\n').map((line) => JSON.parse(line)) : []
  return { ...result, commands, host, target, output: result.stdout + result.stderr }
}

describe('本地 npm 发布流程', () => {
  it('帮助和未知参数不执行外部命令', async () => {
    const help = await execute(['--help'])
    expect(help.status).toBe(0)
    expect(help.commands).toEqual([])
    const invalid = await execute(['--unknown'])
    expect(invalid.status).toBe(1)
    expect(invalid.commands).toEqual([])
  })

  it('演练允许未提交改动，清理旧产物后验证并从解包目录演练发布', async () => {
    const result = await execute(['--dry-run'], { dirty: true })
    expect(result.status, result.output).toBe(0)
    expect(result.commands.some(({ command }) => command === 'git')).toBe(false)
    expect(result.commands.find(({ command }) => command === 'yarn')).toMatchObject({ args: ['yakumo', 'build', 'jmcomic'], cwd: result.host })
    expect(result.commands.filter(({ command }) => command === 'tsc').map(({ args }) => args)).toEqual([
      ['-p', 'tsconfig.json', '--noEmit'], ['-p', 'tsconfig.client.json', '--noEmit'],
    ])
    expect(result.commands.find(({ command }) => command === 'vitest')).toMatchObject({ args: ['run'], cwd: result.target })
    const publish = result.commands.find(({ command }) => command === 'npm')!
    expect(publish.args).toContain('--dry-run')
    expect(publish.args[0]).toBe('publish')
    expect(publish.args[1]).toBe(publish.cwd)
    expect(publish.cwd).toMatch(/unpacked\/package$/)
    expect(result.output).toContain('未发布、未创建或推送标签')
  })

  it.each([
    ['0.0.1', 'latest'], ['0.0.2-alpha.1', 'alpha'], ['0.0.2-dev.1', 'dev'], ['0.0.2-1', 'next'],
  ])('正式发布 %s 使用 %s，确认 registry 后才推送标签', async (version, tag) => {
    const result = await execute([], { version })
    expect(result.status, result.output).toBe(0)
    const publish = result.commands.find(({ command, args }) => command === 'npm' && args[0] === 'publish')!
    expect(publish.args.slice(-2)).toEqual(['--tag', tag])
    expect(publish.args).not.toContain('--dry-run')
    const confirmation = result.commands.findIndex(({ command, args }) => command === 'npm' && args[0] === 'view')
    const createTag = result.commands.findIndex(({ command, args }) => command === 'git' && args[0] === 'tag' && args[1] === `v${version}`)
    expect(createTag).toBeGreaterThan(confirmation)
    expect(result.commands.at(-1)).toMatchObject({ command: 'git', args: ['push', 'origin', `refs/tags/v${version}`] })
  })

  it.each([
    [{ dirty: true }, '未提交'], [{ missingOrigin: true }, '未配置 origin'],
    [{ differentHead: true }, '不一致'], [{ existingTag: true }, '已存在'],
  ])('正式发布拒绝不安全的 Git 状态 %j', async (state, message) => {
    const result = await execute([], state)
    expect(result.status).toBe(1)
    expect(result.output).toContain(message)
    expect(result.commands.some(({ command }) => ['sync', 'yarn', 'npm'].includes(command))).toBe(false)
  })

  it.each(['yarn', 'tsc', 'vitest'])('%s 失败后不发布或打标签', async (failCommand) => {
    const result = await execute(['--dry-run'], { failCommand })
    expect(result.status).toBe(1)
    expect(result.commands.some(({ command }) => ['npm', 'git'].includes(command))).toBe(false)
  })

  it('npm 发布失败时不打标签，错误输出不回显 OTP', async () => {
    const result = await execute(['--otp=123456'], { failPublish: true })
    expect(result.status).toBe(1)
    expect(result.output).not.toContain('123456')
    expect(result.commands.some(({ command, args }) => command === 'npm' && args.includes('--otp=123456'))).toBe(true)
    expect(result.commands.some(({ command, args }) => command === 'git' && (args[0] === 'push' || (args[0] === 'tag' && args[1] !== '--list')))).toBe(false)
  })

  it.each([
    [{ workspaceDependency: true }, 'workspace:'], [{ emptyReadme: true }, 'README 不能为空'],
  ])('拒绝不完整的发布包 %j', async (state, message) => {
    const result = await execute(['--dry-run'], state)
    expect(result.status).toBe(1)
    expect(result.output).toContain(message)
    expect(result.commands.some(({ command }) => command === 'npm')).toBe(false)
  })
})
