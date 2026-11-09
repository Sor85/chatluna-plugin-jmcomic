// 文件路径和输出名称工具。
// 所有从 JM 标题生成的路径都必须先经过这里清理。

import { rm } from 'node:fs/promises'
import type { JmAlbumEntity } from '../jm/types'

// 清理文件名中的非法字符并提供空名称兜底。
export function sanitizeFileName(fileName: string) {
  const sanitized = fileName
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*()[\]{}!#$&;'`~]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 180)
    .replace(/^[._]+|[._]+$/g, '')

  return sanitized || 'untitled'
}

// 根据模板生成输出名，并统一做文件名清理。
export function formatOutputName(template: string, album: JmAlbumEntity) {
  const fields: Record<string, string | number> = {
    name: album.name,
    id: album.id,
    author: album.authors.join('、'),
    tags: album.tags.join('、'),
    actors: album.actors.join('、'),
    chapters: album.photos.length,
    pages: album.photos.reduce((total, photo) => total + photo.images.length, 0)
  }
  return sanitizeFileName(template.replace(/\{(name|id|author|tags|actors|chapters|pages)\}/g, (_match, key: string) => String(fields[key])))
}

// 删除目录或文件，不存在时静默跳过。
export async function removeDirIfExists(path: string) {
  await rm(path, { recursive: true, force: true })
}
