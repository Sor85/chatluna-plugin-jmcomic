// PDF 依赖加载测试。
// 确保插件启动阶段不会因为 PDF 生成依赖缺失而直接失败。

import { describe, expect, it, vi } from 'vitest'

describe('pdf artifact module', () => {
  it('does not require pdfkit while importing the module', async () => {
    vi.resetModules()
    vi.doMock('pdfkit', () => {
      throw new Error('Cannot find module pdfkit')
    })

    await expect(import('../../src/artifact/pdf')).resolves.toHaveProperty('createPdfFromImages')

    vi.doUnmock('pdfkit')
    vi.resetModules()
  })
})
