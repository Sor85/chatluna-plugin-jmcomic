// 下载任务队列测试。
// 覆盖任务状态、失败记录、并发限制和队列输入校验。

import { describe, expect, it } from 'vitest'
import { TaskQueue, type QueueTask } from '../../src/task/queue'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('TaskQueue', () => {
  it('uses short numeric task ids', () => {
    const queue = new TaskQueue<string, string>(async (input) => input, 1)

    expect(queue.add('a').taskId).toBe(1)
    expect(queue.add('b').taskId).toBe(2)
  })

  it('runs tasks and stores completed result', async () => {
    const queue = new TaskQueue<string, string>(async (input) => `${input}-done`, 1)
    const result = queue.add('a')

    expect(result.pendingAhead).toBe(0)
    expect(result.queuePosition).toBe(1)

    await queue.waitForIdle()

    const task = queue.get(result.taskId)
    expect(task?.status).toBe('completed')
    expect(task?.result).toBe('a-done')
    expect(task?.processedAt).toEqual(expect.any(String))
  })

  it('stores failure message', async () => {
    const queue = new TaskQueue<string, string>(async () => {
      throw new Error('boom')
    }, 1)

    const result = queue.add('a')
    await queue.waitForIdle()

    const task = queue.get(result.taskId)
    expect(task?.status).toBe('failed')
    expect(task?.error).toBe('boom')
    expect(task?.processedAt).toEqual(expect.any(String))
  })

  it('does not exceed concurrency limit', async () => {
    let active = 0
    let maxActive = 0
    const releases = Array.from({ length: 4 }, () => deferred<void>())

    const queue = new TaskQueue<number, number>(async (input) => {
      active++
      maxActive = Math.max(maxActive, active)
      await releases[input].promise
      active--
      return input
    }, 2)

    queue.add(0)
    queue.add(1)
    queue.add(2)
    queue.add(3)

    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(maxActive).toBe(2)

    releases[0].resolve()
    releases[1].resolve()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(maxActive).toBe(2)

    releases[2].resolve()
    releases[3].resolve()
    await queue.waitForIdle()

    expect(queue.list().map((task) => task.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed'
    ])
  })

  it('returns a copied task list', async () => {
    const queue = new TaskQueue<string, string>(async (input) => input, 1)
    const result = queue.add('a')
    const tasks = queue.list()

    tasks.push({
      id: 999,
      input: 'b',
      status: 'pending',
      createdAt: new Date().toISOString()
    } satisfies QueueTask<string, string>)

    expect(queue.list()).toHaveLength(1)
    expect(queue.get(result.taskId)?.input).toBe('a')
    await queue.waitForIdle()
  })

  it('rejects invalid concurrency', () => {
    for (const concurrency of [0, -1, Number.NaN, 1.5, Infinity]) {
      expect(() => new TaskQueue<string, string>(async (input) => input, concurrency)).toThrow(RangeError)
    }
  })

  it('waits for one task to finish', async () => {
    const release = deferred<void>()
    const queue = new TaskQueue<string, string>(async (input) => {
      await release.promise
      return `${input}-done`
    }, 1)
    const result = queue.add('a')
    const waiting = queue.waitForTask(result.taskId, 1000)

    release.resolve()

    await expect(waiting).resolves.toMatchObject({
      id: result.taskId,
      status: 'completed',
      result: 'a-done'
    })
  })

  it('waits for one task to finish without timeout', async () => {
    const release = deferred<void>()
    const queue = new TaskQueue<string, string>(async (input) => {
      await release.promise
      return `${input}-done`
    }, 1)
    const result = queue.add('a')
    const waiting = queue.waitForTask(result.taskId)

    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    expect(queue.get(result.taskId)?.status).toBe('processing')

    release.resolve()

    await expect(waiting).resolves.toMatchObject({
      id: result.taskId,
      status: 'completed',
      result: 'a-done'
    })
  })

  it('returns current task when single task wait times out', async () => {
    const release = deferred<void>()
    const queue = new TaskQueue<string, string>(async (input) => {
      await release.promise
      return input
    }, 1)
    const result = queue.add('a')

    await expect(queue.waitForTask(result.taskId, 1)).resolves.toMatchObject({
      id: result.taskId,
      status: 'processing'
    })

    release.resolve()
    await queue.waitForIdle()
  })

  it('prunes terminal tasks older than the retention window', async () => {
    const queue = new TaskQueue<string, string>(async (input) => input, 1)
    const oldResult = queue.add('old')
    const freshResult = queue.add('fresh')
    await queue.waitForIdle()

    const oldTask = queue.get(oldResult.taskId)
    const freshTask = queue.get(freshResult.taskId)
    oldTask!.processedAt = '2026-05-20T00:00:00.000Z'
    freshTask!.processedAt = '2026-05-21T23:30:00.000Z'

    const removed = queue.pruneTerminalTasks(24 * 60 * 60 * 1000, new Date('2026-05-22T00:00:00.000Z'))

    expect(removed).toBe(1)
    expect(queue.get(oldResult.taskId)).toBeUndefined()
    expect(queue.get(freshResult.taskId)?.input).toBe('fresh')
  })
})
