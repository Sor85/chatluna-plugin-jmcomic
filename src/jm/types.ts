// JM API 原始类型和插件内部实体类型。

export interface JmAlbumSeries {
  id: string
  name: string
  sort: string
}

export interface JmAlbumJson {
  id: number
  name: string
  images: string[]
  addtime: string
  description: string
  total_views: string
  likes: string
  series: JmAlbumSeries[]
  author: string[]
  tags: string[]
  actors: string[]
}

export interface JmPhotoJson {
  id: number
  name: string
  images: string[]
}

export interface JmSearchContentJson {
  id: string
  author: string
  description: string
  name: string
  image: string
  category: { id: string; title: string }
  category_sub: { id: string; title: string | null }
}

export interface JmSearchJson {
  search_query: string
  total: string
  content: JmSearchContentJson[]
}

export interface JmPhotoEntity {
  id: string
  images: string[]
  getSplitNumbers(scrambleId: number): number[]
}

export interface JmAlbumEntity {
  id: string
  name: string
  description: string
  cover?: string
  publishedAt: string
  authors: string[]
  tags: string[]
  actors: string[]
  likes: string
  totalViews: string
  series: JmAlbumSeries[]
  photos: JmPhotoEntity[]
}
