import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'lib', 'dist', '.git'].includes(entry.name)) return []
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
describe('项目约定守卫', () => {
  it('子目录说明全部登记且路径存在', () => {
    const instructions = readFileSync(resolve(root, 'AGENTS.md'), 'utf8')
    const documented = [...instructions.matchAll(/`([^`]+\/AGENTS\.md)`/g)].map((match) => match[1]).sort()
    const actual = files(root).filter((path) => path.endsWith('/AGENTS.md') && path !== resolve(root, 'AGENTS.md')).map((path) => relative(root, path)).sort()
    expect(documented).toEqual(actual)
  })
  it('无旧框架依赖和本地工具开关', () => {
    const source = files(resolve(root, 'src')).filter((path) => /\.tsx?$/.test(path)).map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(source).not.toMatch(/from ['"](?:koishi|zod|@langchain)/)
    expect(source).not.toMatch(/enabledTools|searchTool:|browseTool:|infoTool:|downloadTool:/)
  })
  it('客户端不覆盖鼠标指针，不另建滚动或保存机制', () => {
    const source = files(resolve(root, 'client')).filter((path) => /\.(tsx?|css)$/.test(path)).map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(source).not.toMatch(/cursor\s*:|cursor-|localStorage|::-webkit-scrollbar|overflow-y-auto/)
  })
})
