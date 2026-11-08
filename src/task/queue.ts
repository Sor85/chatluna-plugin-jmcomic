export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface QueueTask<Input, Result> {
  id: number
  input: Input
  status: TaskStatus
  createdAt: string
  processedAt?: string
  result?: Result
  error?: string
}

export interface AddTaskResult {
  taskId: number
  pendingAhead: number
  queuePosition: number
}

export class TaskQueue<Input, Result> {
  private tasks: Array<QueueTask<Input, Result>> = []
  private active = 0
  private nextId = 1
  private stopped = false
  private idleResolvers: Array<() => void> = []
  private taskResolvers = new Map<number, Set<() => void>>()

  constructor(private processor: (input: Input) => Promise<Result>, private concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('concurrency must be a positive integer')
  }

  add(input: Input): AddTaskResult {
    if (this.stopped) throw new Error('JMComic queue is stopped')
    const pendingAhead = this.tasks.filter((task) => !isTerminal(task)).length
    const task: QueueTask<Input, Result> = { id: this.nextId++, input, status: 'pending', createdAt: new Date().toISOString() }
    this.tasks.push(task)
    queueMicrotask(() => this.process())
    return { taskId: task.id, pendingAhead, queuePosition: pendingAhead + 1 }
  }

  get(id: number) { return this.tasks.find((task) => task.id === id) }
  list() { return [...this.tasks] }

  stop() {
    this.stopped = true
    for (const task of this.tasks) {
      if (task.status !== 'pending') continue
      task.status = 'failed'
      task.error = 'JMComic plugin unloaded'
      task.processedAt = new Date().toISOString()
      this.resolveTask(task.id)
    }
    this.resolveIdle()
  }

  pruneTerminalTasks(retentionMs: number, now = new Date()): number {
    if (retentionMs <= 0) return 0
    const before = this.tasks.length
    const expiresBefore = now.getTime() - retentionMs
    this.tasks = this.tasks.filter((task) => !isTerminal(task) || Date.parse(task.processedAt ?? task.createdAt) > expiresBefore)
    return before - this.tasks.length
  }

  async waitForIdle(): Promise<void> {
    if (this.isIdle()) return
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve))
  }

  async waitForTask(id: number, timeoutMs?: number): Promise<QueueTask<Input, Result> | undefined> {
    const task = this.get(id)
    if (!task || isTerminal(task)) return task
    await new Promise<void>((resolve) => {
      const resolvers = this.taskResolvers.get(id) ?? new Set()
      const finish = () => {
        clearTimeout(timeout)
        resolvers.delete(finish)
        if (!resolvers.size) this.taskResolvers.delete(id)
        resolve()
      }
      const timeout = timeoutMs === undefined ? undefined : setTimeout(finish, timeoutMs)
      resolvers.add(finish)
      this.taskResolvers.set(id, resolvers)
    })
    return this.get(id)
  }

  private process() {
    while (!this.stopped && this.active < this.concurrency) {
      const task = this.tasks.find((item) => item.status === 'pending')
      if (!task) break
      this.active++
      task.status = 'processing'
      void this.run(task)
    }
  }

  private async run(task: QueueTask<Input, Result>) {
    try {
      task.result = await this.processor(task.input)
      task.status = 'completed'
    } catch (error) {
      task.status = 'failed'
      task.error = error instanceof Error ? error.message : String(error)
    } finally {
      task.processedAt = new Date().toISOString()
      this.active--
      this.resolveTask(task.id)
      this.process()
      this.resolveIdle()
    }
  }

  private isIdle() { return this.active === 0 && this.tasks.every(isTerminal) }
  private resolveIdle() {
    if (this.isIdle()) for (const resolve of this.idleResolvers.splice(0)) resolve()
  }
  private resolveTask(id: number) {
    const resolvers = this.taskResolvers.get(id)
    this.taskResolvers.delete(id)
    for (const resolve of resolvers ?? []) resolve()
  }
}

function isTerminal(task: QueueTask<unknown, unknown>) {
  return task.status === 'completed' || task.status === 'failed'
}
