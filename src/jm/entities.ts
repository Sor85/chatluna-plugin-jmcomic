// JM 实体转换。
// 这里封装 album/photo 字段整理和图片分割数规则。

import { md5Hex } from './crypto'
import { JmAlbumEntity, JmAlbumJson, JmPhotoEntity, JmPhotoJson } from './types'

const SCRAMBLE_268850 = 268850
const SCRAMBLE_421926 = 421926

// 从章节 JSON 创建内部章节实体。
export function createPhotoEntity(json: JmPhotoJson): JmPhotoEntity {
  const id = String(json.id)
  const imageNames = json.images.map((image) => image.split('.')[0])

  return {
    id,
    images: json.images,
    getSplitNumbers(scrambleId: number) {
      return imageNames.map((name) => {
        const numericId = Number(id)
        if (numericId < scrambleId) return 0
        if (numericId < SCRAMBLE_268850) return 10

        const base = numericId < SCRAMBLE_421926 ? 10 : 8
        const hash = md5Hex(`${numericId}${name}`)
        const lastChar = hash[hash.length - 1]
        return (lastChar.charCodeAt(0) % base) * 2 + 2
      })
    }
  }
}

// 从本子 JSON 和章节列表创建内部本子实体。
export function createAlbumEntity(json: JmAlbumJson, photos: JmPhotoEntity[]): JmAlbumEntity {
  return {
    id: String(json.id),
    name: json.name,
    description: json.description,
    cover: json.images?.[0],
    publishedAt: json.addtime,
    authors: json.author ?? [],
    tags: json.tags ?? [],
    actors: json.actors ?? [],
    likes: json.likes,
    totalViews: json.total_views,
    series: json.series ?? [],
    photos
  }
}
