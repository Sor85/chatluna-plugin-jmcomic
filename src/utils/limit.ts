// 失败后等待其他 worker 停止，避免调用方清理目录时仍有后台写入。
export async function limitAll<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be greater than 0')
  const results: T[] = new Array(jobs.length)
  let next = 0
  let failed = false
  let failure: unknown
  async function worker() {
    while (!failed && next < jobs.length) {
      const current = next++
      try {
        results[current] = await jobs[current]()
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, () => worker()))
  if (failed) throw failure
  return results
}
