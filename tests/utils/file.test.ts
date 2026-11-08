// 文件工具测试。
// 覆盖文件名清理和输出文件名模板，避免平台非法字符进入文件路径。

import { describe, expect, it } from 'vitest'
import { filterSensitiveFileName, formatOutputName, sanitizeFileName } from '../../src/utils/file'

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
  it('replaces known placeholders and sanitizes result', () => {
    expect(formatOutputName('{{name}} ({{id}})', 'A/B', '123')).toBe('A_B_123')
  })

  it('replaces index placeholder', () => {
    expect(formatOutputName('{{name}}-{{id}}-{{index}}', 'A', '123', 2)).toBe('A-123-2')
  })
})

describe('filterSensitiveFileName', () => {
  it('replaces sensitive words with same-length stars', () => {
    expect(filterSensitiveFileName('NMDLHT_沉淪在肉棒下的大噴菇_530988.zip'))
      .toBe('NMDLHT_沉淪在**下的大噴菇_530988.zip')
  })
})
