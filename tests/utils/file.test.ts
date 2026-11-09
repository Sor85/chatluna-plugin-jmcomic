// 文件工具测试。
// 覆盖文件名清理和输出文件名模板，避免平台非法字符进入文件路径。

import { describe, expect, it } from 'vitest'
import { formatOutputName, sanitizeFileName } from '../../src/utils/file'
import { createAlbumEntity, createPhotoEntity } from '../../src/jm/entities'

const album = createAlbumEntity({
  id: 123, name: 'A/B', images: [], addtime: '', description: '', total_views: '0', likes: '0', series: [],
  author: ['作者甲', '作者乙'], tags: ['标签甲', '标签乙'], actors: ['角色甲']
}, [
  createPhotoEntity({ id: 1, name: '章节一', images: ['1.png', '2.png'] }),
  createPhotoEntity({ id: 2, name: '章节二', images: ['1.png'] })
])

describe('sanitizeFileName', () => {
  it('replaces unsafe characters', () => {
    expect(sanitizeFileName('a/b:c*? <x>')).toBe('a_b_c_x')
  })

  it('uses fallback for empty names', () => {
    expect(sanitizeFileName('***')).toBe('untitled')
  })

  it('removes edge dots after truncation', () => {
    expect(sanitizeFileName(`${'a'.repeat(179)}.tail`)).toBe('a'.repeat(179))
  })

  it('replaces control characters', () => {
    expect(sanitizeFileName('a\u0000b\u001fc')).toBe('a_b_c')
  })
})

describe('formatOutputName', () => {
  it('replaces single-brace placeholders and sanitizes the result', () => {
    expect(formatOutputName('{name} ({id})', album)).toBe('A_B_123')
  })

  it('supports metadata arrays and counts every exported chapter and page', () => {
    expect(formatOutputName('{author}-{name}-{id}-{tags}-{actors}-{chapters}章-{pages}页', album))
      .toBe('作者甲、作者乙-A_B-123-标签甲、标签乙-角色甲-2章-3页')
  })

  it('leaves missing metadata empty and replaces repeated placeholders', () => {
    expect(formatOutputName('{author}{tags}{actors}{id}-{id}', { ...album, authors: [], tags: [], actors: [] }))
      .toBe('123-123')
  })

  it('does not recursively expand placeholders inside metadata', () => {
    expect(formatOutputName('{name}-{id}', { ...album, name: '{id}' })).toBe('id_-123')
  })
})
