#!/usr/bin/env node
// 在源码仓库用 node 运行；依赖、构建与打包均在 v2 副本完成，不在源码目录安装依赖。
// --dry-run 允许未提交改动，只演练发布；正式发布要求 HEAD 与 origin 的同名分支一致。
// 两步验证可传 --otp=<验证码>，脚本不会打印该参数。

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const v2Root = path.resolve(process.env.CHATLUNA_V2_ROOT ?? path.join(source, '../../chatluna-v2-mirror'))
const target = path.join(v2Root, 'external', 'jmcomic')
const registry = 'https://registry.npmjs.org/'
const env = { ...process.env, CHATLUNA_V2_ROOT: v2Root }
const run = (command, args, cwd = source) => execFileSync(command, args, { cwd, env, stdio: 'inherit' })
const read = (command, args, cwd = source) => execFileSync(command, args, { cwd, env, stdio: 'pipe', encoding: 'utf8' }).trim()

async function main() {
  const { values } = parseArgs({ options: {
    'dry-run': { type: 'boolean' },
    otp: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } })
  if (values.help) {
    console.log('用法：node scripts/publish.mjs [--dry-run] [--otp=<验证码>]\n正式发布会发布到 npm，并创建和推送 v<版本> Git 标签；演练不发布、不操作 Git 标签。\nCHATLUNA_V2_ROOT 可指定 ChatLuna v2 仓库；默认 ../../chatluna-v2-mirror。')
    return
  }
  if (values.otp !== undefined && !/^\d{6}$/.test(values.otp)) throw new Error('OTP 必须为六位数字')
  const dryRun = values['dry-run'] === true
  const { name, version } = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
  const tag = `v${version}`
  const prerelease = version.split('+')[0].match(/-([0-9A-Za-z-]+)/)?.[1]
  const distTag = prerelease ? (/^\d+$/.test(prerelease) ? 'next' : prerelease) : 'latest'

  if (!fs.existsSync(path.join(v2Root, 'package.json'))) throw new Error('未找到 ChatLuna v2 仓库，可用 CHATLUNA_V2_ROOT 指定')
  let revision
  if (!dryRun) {
    if (read('git', ['status', '--porcelain'])) throw new Error('工作区有未提交的改动，先提交或还原')
    const branch = read('git', ['branch', '--show-current'])
    if (!branch) throw new Error('当前为 detached HEAD，正式发布需要位于分支上')
    try {
      read('git', ['remote', 'get-url', 'origin'])
    } catch {
      throw new Error('未配置 origin，先配置远端并推送当前分支')
    }
    run('git', ['fetch', 'origin', '--tags', '--quiet'])
    if (read('git', ['tag', '--list', tag])) throw new Error(`标签 ${tag} 已存在，先更新 package.json 的 version`)
    revision = read('git', ['rev-parse', 'HEAD'])
    if (revision !== read('git', ['rev-parse', `refs/remotes/origin/${branch}`])) {
      throw new Error('当前提交与 origin 的同名分支不一致，先同步分支')
    }
    try {
      read('npm', ['whoami', '--registry', registry])
    } catch {
      throw new Error(`npm 未登录或 registry 不可用，先运行 npm login --registry=${registry}`)
    }
  }

  console.log(`[publish] ${name}@${version} → ${distTag}${dryRun ? '（演练，不发布）' : ''}`)
  run(process.execPath, [path.join(source, 'scripts', 'sync-to-v2.mjs'), '--once'])
  // 同时清理增量缓存，否则删除 lib 后 tsc 仍可能跳过声明文件生成。
  for (const entry of ['lib', 'dist', 'tsconfig.tsbuildinfo']) fs.rmSync(path.join(target, entry), { recursive: true, force: true })
  run('yarn', ['yakumo', 'build', 'jmcomic'], v2Root)
  const bin = path.join(v2Root, 'node_modules', '.bin')
  run(path.join(bin, 'tsc'), ['-p', 'tsconfig.json', '--noEmit'], target)
  run(path.join(bin, 'tsc'), ['-p', 'tsconfig.client.json', '--noEmit'], target)
  run(path.join(bin, 'vitest'), ['run'], target)

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmcomic-publish-'))
  const tarball = path.join(workdir, 'package.tgz')
  const unpacked = path.join(workdir, 'unpacked')
  fs.mkdirSync(unpacked)
  console.log(`[publish] 本次打包目录：${workdir}`)
  // Yarn 会改写 workspace:*；npm 直接打包不会。
  run('yarn', ['pack', '--out', tarball], target)
  run('tar', ['-xzf', tarball, '-C', unpacked])
  const packageDir = path.join(unpacked, 'package')
  const packed = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  if (packed.name !== name || packed.version !== version) throw new Error('打包后的包名或版本不一致')
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    if (Object.values(packed[section] ?? {}).some((value) => value.startsWith('workspace:'))) {
      throw new Error(`打包后的 ${section} 仍包含 workspace: 依赖`)
    }
  }
  for (const file of ['lib/index.js', 'lib/index.d.ts', 'dist/client.js', 'dist/client.css', 'client/index.ts', 'README.md', 'LICENSE']) {
    if (!fs.statSync(path.join(packageDir, file)).isFile()) throw new Error(`发布包缺少文件：${file}`)
  }
  if (!fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8').trim()) throw new Error('发布包 README 不能为空')

  if (!dryRun && (read('git', ['status', '--porcelain']) || read('git', ['rev-parse', 'HEAD']) !== revision)) {
    throw new Error('构建期间源码或 HEAD 已改变，已停止发布')
  }
  // 必须从解包目录发布，使 npm 元数据包含 README，不能直接发布 tgz。
  const args = ['publish', packageDir, '--access', 'public', '--registry', registry, '--tag', distTag]
  if (dryRun) args.push('--dry-run')
  else if (values.otp) args.push(`--otp=${values.otp}`)
  run('npm', args, packageDir)
  if (dryRun) {
    console.log(`[publish] 演练完成，未发布、未创建或推送标签。包文件：${tarball}`)
    return
  }

  // npm 可能先接受发布再异步更新标签，确认 registry 可见后才标记 Git 版本。
  console.log(`[publish] npm 已接受发布，正在确认 ${distTag} 指向 ${version}`)
  let published = false
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      published = JSON.parse(read('npm', ['view', name, `dist-tags.${distTag}`, '--json', '--registry', registry, '--prefer-online'])) === version
    } catch {
      // 发布后的短暂不可见或网络错误允许重试，不重复执行 publish。
    }
    if (published) break
    await setTimeout(2000)
  }
  if (!published) throw new Error('npm 可能已接受发布，但未确认 dist-tag；请核对 registry，不要直接重复发布')
  run('git', ['tag', tag])
  run('git', ['push', 'origin', `refs/tags/${tag}`])
  console.log(`[publish] 已确认 ${name}@${version}（${distTag}），标签 ${tag} 已推送`)
}

main().catch((error) => {
  // execFileSync 的默认错误消息会回显完整命令，不能泄漏 --otp。
  const message = 'status' in error ? `外部命令执行失败（退出码 ${error.status}），已停止后续步骤；若 npm 已发布，请核对 registry 与 Git 标签后再处理` : error.message
  console.error(`[publish] ${message}`)
  process.exitCode = 1
})
