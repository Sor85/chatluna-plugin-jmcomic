import type { Config } from '../config'
import { JmRequestError } from '../errors'
import type { Logger } from '../types'
import { JM_API_DOMAIN_SERVER_LIST, JM_API_DOMAIN_SERVER_SECRET, JM_CLIENT_URL_LIST, JM_IMAGE_URL_LIST } from './constants'
import { decodeEncryptedJson } from './crypto'

export interface JmHttpOptions {
  fetch: typeof globalThis.fetch
  logger: Logger
  config: Pick<Config, 'retryCount' | 'debug'>
  signal: AbortSignal
}

interface RequestOptions {
  headers?: Record<string, string>
  params?: Record<string, string | number>
  signal?: AbortSignal
}

export class JmHttp {
  private updatedClientHosts?: string[]

  constructor(private options: JmHttpOptions) {}

  async request(path: string, method: 'GET' | 'POST', options: RequestOptions = {}, kind: 'client' | 'image' = 'client'): Promise<Buffer> {
    const signal = AbortSignal.any([this.options.signal, ...(options.signal ? [options.signal] : [])])
    let lastError: unknown
    for (let round = 0; round < 2; round++) {
      const hosts = kind === 'client' ? this.updatedClientHosts ?? JM_CLIENT_URL_LIST : JM_IMAGE_URL_LIST
      for (const host of hosts) {
        const url = new URL(path, `https://${host}`)
        for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, String(value))
        for (let attempt = 1; attempt <= this.options.config.retryCount; attempt++) {
          signal.throwIfAborted()
          try {
            const bytes = await this.fetchBytes(url.href, method, options.headers, signal, kind === 'image' ? 64 * 1024 * 1024 : 8 * 1024 * 1024)
            if (bytes.length === 0) throw new Error('empty response')
            return bytes
          } catch (error) {
            signal.throwIfAborted()
            lastError = error
            if (this.options.config.debug) this.options.logger.warn('JM request failed: %s %s (%s/%s): %s', method, path, attempt, this.options.config.retryCount, String(error))
          }
        }
      }
      if (kind !== 'client' || round > 0) break
      const hostsUpdated = await this.fetchLatestClientHosts(signal)
      if (!hostsUpdated.length) break
      this.updatedClientHosts = hostsUpdated
    }
    throw new JmRequestError(`JM request failed: ${method} ${path}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
  }

  private async fetchBytes(url: string, method: 'GET' | 'POST', headers: Record<string, string> | undefined, signal: AbortSignal, limit: number) {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)])
    const response = await this.options.fetch(url, { method, headers, signal: requestSignal })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel()
      throw new Error('JM response exceeds size limit')
    }
    if (!response.body) return Buffer.alloc(0)
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        requestSignal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > limit) throw new Error('JM response exceeds size limit')
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    return Buffer.concat(chunks)
  }

  private async fetchLatestClientHosts(signal: AbortSignal): Promise<string[]> {
    for (const url of JM_API_DOMAIN_SERVER_LIST) {
      signal.throwIfAborted()
      try {
        const bytes = await this.fetchBytes(url, 'GET', undefined, signal, 1024 * 1024)
        const data = decodeEncryptedJson<{ Server?: unknown }>(bytes.toString('utf8').replace(/^[^\x00-\x7F]+/, ''), '', JM_API_DOMAIN_SERVER_SECRET)
        if (!Array.isArray(data.Server)) continue
        const hosts: string[] = data.Server.filter((host): host is string => typeof host === 'string' && /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(host))
        if (hosts.length) return hosts
      } catch (error) {
        signal.throwIfAborted()
        if (this.options.config.debug) this.options.logger.warn('JM domain update failed: %s', String(error))
      }
    }
    return []
  }
}
