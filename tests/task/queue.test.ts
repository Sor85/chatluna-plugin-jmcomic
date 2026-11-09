// 下载任务队列测试。
// 覆盖任务状态、失败记录、并发限制和队列输入校验。

import { describe, expect, it } from 'vitest'
import { TaskQueue, type QueueTask } from '../../src/task/queue'

describe('TaskQueue', () => {
  it('uses short numeric task ids', () => {
    const queue = new TaskQueue<string, string>(async (input) => input, 1)

    expect(queue.add('a')).toBe(1)
    expect(queue.add('b')).toBe(2)
  })

  it('runs tasks and stores completed result', async () => {
    const queue = new TaskQueue<string, string>(async (input) => `${input}-done`, 1)
    const taskId = queue.add('a')

    await queue.waitForIdle()

    const task = queue.get(taskId)
    expect(task?.status).toBe('completed')
    expect(task?.result).toBe('a-done')
    expect(task?.processedAt).toEqual(expect.any(String))
  })

  it('stores failure message', async () => {
    const queue = new TaskQueue<string, string>(async () => {
      throw new Error('boom')
    }, 1)

    const taskId = queue.add('a')
    await queue.waitForIdle()

    const task = queue.get(taskId)
    expect(task?.status).toBe('failed')
    expect(task?.error).toBe('boom')
    expect(task?.processedAt).toEqual(expect.any(String))
  })

  it('does not exceed concurrency limit', async () => {
    let active = 0
    let maxActive = 0
    const releases = Array.from({ length: 4 }, () => Promise.withResolvers<void>())

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
    const taskId = queue.add('a')
    const tasks = queue.list()

    tasks.push({
      id: 999,
      input: 'b',
      status: 'pending',
      createdAt: new Date().toISOString()
    } satisfies QueueTask<string, string>)

    expect(queue.list()).toHaveLength(1)
    expect(queue.get(taskId)?.input).toBe('a')
    await queue.waitForIdle()
  })

  it('rejects invalid concurrency', () => {
    for (const concurrency of [0, -1, Number.NaN, 1.5, Infinity]) {
      expect(() => new TaskQueue<string, string>(async (input) => input, concurrency)).toThrow(RangeError)
    }
  })

  it('resolves all waiters only after the task finishes', async () => {
    const release = Promise.withResolvers<void>()
    const queue = new TaskQueue<string, string>(async (input) => {
      await release.promise
      return `${input}-done`
    }, 1)
    const taskId = queue.add('a')
    let finished = false
    const waiting = Promise.all([queue.waitForTask(taskId), queue.waitForTask(taskId)])
      .then((tasks) => { finished = true; return tasks })

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(queue.get(taskId)?.status).toBe('processing')
    expect(finished).toBe(false)

    release.resolve()

    for (const task of await waiting) {
      expect(task).toMatchObject({ id: taskId, status: 'completed', result: 'a-done' })
    }
    expect(await queue.waitForTask(taskId)).toBe(queue.get(taskId))
    expect(await queue.waitForTask(999)).toBeUndefined()
  })

  it('prunes terminal tasks older than the retention window', async () => {
    const queue = new TaskQueue<string, string>(async (input) => input, 1)
    const oldId = queue.add('old')
    const freshId = queue.add('fresh')
    await queue.waitForIdle()

    const oldTask = queue.get(oldId)
    const freshTask = queue.get(freshId)
    oldTask!.processedAt = '2026-05-20T00:00:00.000Z'
    freshTask!.processedAt = '2026-05-21T23:30:00.000Z'

    const removed = queue.pruneTerminalTasks(24 * 60 * 60 * 1000, new Date('2026-05-22T00:00:00.000Z'))

    expect(removed).toBe(1)
    expect(queue.get(oldId)).toBeUndefined()
    expect(queue.get(freshId)?.input).toBe('fresh')
  })
})
