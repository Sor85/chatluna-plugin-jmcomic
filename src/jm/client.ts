import { Schema } from '@chatluna/schema'
import { AlbumNotFoundError, InvalidInputError, PhotoNotFoundError } from '../errors'
import { limitAll } from '../utils/limit'
import { JM_APP_TOKEN_SECRET_2 } from './constants'
import { createTokenHeaders, decodeEncryptedJson } from './crypto'
import { createAlbumEntity, createPhotoEntity } from './entities'
import type { JmHttp } from './http'
import type { JmAlbumEntity, JmAlbumJson, JmPhotoEntity, JmPhotoJson, JmSearchJson } from './types'

export type BrowseTimeRange = 'today' | 'week' | 'month' | 'all'
export type BrowseCategory = 'all' | 'doujin' | 'single' | 'short' | 'another' | 'hanman' | 'meiman' | 'doujin_cosplay' | 'cosplay' | '3d' | 'english_site'
export type BrowseOrderBy = 'latest' | 'view' | 'picture' | 'like' | 'month_rank' | 'week_rank' | 'day_rank'
export interface BrowseOptions {
  page: number
  time: BrowseTimeRange
  category: BrowseCategory
  orderBy: BrowseOrderBy
}
const timeMap: Record<BrowseTimeRange, string> = { today: 't', week: 'w', month: 'm', all: 'a' }
const categoryMap: Record<BrowseCategory, string> = {
  all: '0', doujin: 'doujin', single: 'single', short: 'short', another: 'another', hanman: 'hanman',
  meiman: 'meiman', doujin_cosplay: 'doujin_cosplay', cosplay: 'doujin_cosplay', '3d': '3D', english_site: 'english_site'
}
const orderMap: Record<BrowseOrderBy, string> = {
  latest: 'mr', view: 'mv', picture: 'mp', like: 'tf', month_rank: 'mv_m', week_rank: 'mv_w', day_rank: 'mv_t'
}
const envelope = Schema.object({ code: Schema.number().required(), data: Schema.string().required() })

export function validateId(id: string) {
  if (!/^\d+$/.test(id)) throw new InvalidInputError('albumId / photoId 必须是数字')
}

export class JmClient {
  constructor(private http: JmHttp) {}

  private async api<T>(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
    const timestamp = Date.now()
    const bytes = await this.http.request(path, 'POST', { headers: createTokenHeaders(timestamp), params, signal })
    const response = envelope(JSON.parse(bytes.toString('utf8')))
    if (response.code !== 200) throw new Error(`JM API error: ${response.code}`)
    return decodeEncryptedJson<T>(response.data, timestamp)
  }

  async search(query: string, signal?: AbortSignal): Promise<JmSearchJson> {
    const result = await this.api<JmSearchJson>('/search', { search_query: query }, signal)
    if (!Array.isArray(result.content)) throw new Error('Invalid JM search response')
    return result
  }

  async browse(options: BrowseOptions, signal?: AbortSignal): Promise<JmSearchJson> {
    const time = timeMap[options.time]
    const order = orderMap[options.orderBy]
    const result = await this.api<JmSearchJson>('/categories/filter', {
      page: options.page, order: '', c: categoryMap[options.category], o: time === 'a' ? order : `${order}_${time}`
    }, signal)
    if (!Array.isArray(result.content)) throw new Error('Invalid JM category response')
    return result
  }

  async getAlbumById(albumId: string, signal?: AbortSignal): Promise<JmAlbumEntity> {
    validateId(albumId)
    const json = await this.api<JmAlbumJson>('/album', { id: albumId }, signal)
    if (!json.name) throw new AlbumNotFoundError(`Album not found: ${albumId}`)
    validateId(String(json.id))
    if (String(json.id) !== albumId) throw new Error('JM album ID does not match request')
    const series = json.series?.length ? json.series : [{ id: albumId, name: json.name, sort: '1' }]
    const photos = await limitAll(series.map((photo) => () => this.getPhotoById(String(photo.id), signal)), 2)
    return createAlbumEntity({ ...json, series }, photos)
  }

  async getPhotoById(photoId: string, signal?: AbortSignal): Promise<JmPhotoEntity> {
    validateId(photoId)
    const json = await this.api<JmPhotoJson>('/chapter', { id: photoId }, signal)
    if (!json.name) throw new PhotoNotFoundError(`Photo not found: ${photoId}`)
    validateId(String(json.id))
    if (String(json.id) !== photoId || !Array.isArray(json.images) || json.images.some((image) => typeof image !== 'string' || !/^[\w.-]+$/.test(image) || image === '.' || image === '..')) {
      throw new Error('Invalid JM chapter response')
    }
    return createPhotoEntity(json)
  }

  async requestScrambleId(photoId: string, signal?: AbortSignal): Promise<number> {
    validateId(photoId)
    const timestamp = Date.now()
    const html = await this.http.request('/chapter_view_template', 'POST', {
      headers: createTokenHeaders(timestamp, JM_APP_TOKEN_SECRET_2), params: { id: photoId }, signal
    })
    const matched = html.toString('utf8').match(/var scramble_id = (\d+);/)
    return matched ? Number(matched[1]) : 0
  }

  async downloadImage(photoId: string, image: string, signal?: AbortSignal): Promise<Buffer> {
    validateId(photoId)
    return this.http.request(`/media/photos/${photoId}/${encodeURIComponent(image)}`, 'GET', { signal }, 'image')
  }
}
