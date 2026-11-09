// ZIP 导出测试。
// 验证普通 ZIP 和密码 ZIP 都能生成非空文件，不访问真实网络。

import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createZipFromDirectory } from '../../src/artifact/zip'

const root = join(process.cwd(), '.tmp-zip-test')

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('createZipFromDirectory', () => {
  it('creates a non-empty zip', async () => {
    const input = join(root, 'input')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.txt'), 'hello')

    const output = join(root, 'out.zip')
    await createZipFromDirectory([{ directory: input, destpath: false }], output, undefined, 6)

    expect((await stat(output)).size).toBeGreaterThan(0)
  })

  it('creates a non-empty password zip', async () => {
    const input = join(root, 'encrypted-input')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.txt'), 'hello')

    const output = join(root, 'encrypted.zip')
    await createZipFromDirectory([{ directory: input, destpath: false }], output, 'secret', 6)

    expect((await stat(output)).size).toBeGreaterThan(0)
  })

  it('rejects when source directory does not exist', async () => {
    await mkdir(root, { recursive: true })
    const output = join(root, 'missing-dir.zip')

    await expect(createZipFromDirectory([{ directory: join(root, 'missing'), destpath: false }], output, undefined, 6))
      .rejects.toThrow()
  })
})
