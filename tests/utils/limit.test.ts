// 并发工具测试。
// 覆盖结果顺序、空任务、异常传播和非法并发数。

import { describe, expect, it } from 'vitest'
import { limitAll } from '../../src/utils/limit'

describe('limitAll', () => {
  it('keeps result order', async () => {
    const result = await limitAll([
      async () => 'a',
      async () => 'b',
      async () => 'c'
    ], 2)

    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('returns empty result for empty jobs', async () => {
    await expect(limitAll([], 1)).resolves.toEqual([])
  })

  it('rejects when a job fails', async () => {
    await expect(limitAll([
      async () => 'ok',
      async () => {
        throw new Error('boom')
      }
    ], 1)).rejects.toThrow('boom')
  })

  it('rejects invalid concurrency', async () => {
    for (const limit of [0, -1, Number.NaN, 1.5, Infinity]) {
      await expect(limitAll([async () => 'a'], limit)).rejects.toThrow('limit must be greater than 0')
    }
  })
})
