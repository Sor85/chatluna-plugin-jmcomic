// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Context } from 'cordis'
import { LocaleService, RootContext } from '@chatluna/ui-client/client'
import { SchemaForm, extensionOf } from '@chatluna/ui-schema-form/client'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import apply from '../client'
import { FileMethodField } from '../client/file-method-field'
import { Config } from '../src/config'

const schema = Config.list?.[1]?.dict?.['fileMethod']
if (!schema) throw new Error('Missing fileMethod')
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
afterAll(() => vi.unstubAllGlobals())
let root: Root | undefined
let ctx: Context | undefined
let container: HTMLDivElement
afterEach(async () => {
  await act(async () => root?.unmount())
  await ctx?.fiber.dispose()
  root = undefined
  container?.remove()
})
async function mount(initial: Record<string, unknown> = {}) {
  ctx = new Context()
  await ctx.plugin(LocaleService)
  ctx.locale.setLocale('zh')
  await ctx.plugin({ inject: ['locale'], apply })
  const context = ctx
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let current = initial
  function Form() {
    const [value, setValue] = useState(initial)
    current = value
    return <RootContext value={context}><SchemaForm schema={Config} value={value} initial={initial} onChange={setValue} /></RootContext>
  }
  await act(async () => root?.render(<Form />))
  return { context, current: () => current }
}
describe('ui-kit 配置控件', () => {
  it('默认模式、完整说明与三个选项，不创建旧工具设置', async () => {
    const app = await mount()
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(container.textContent).toContain('相同绝对路径')
    expect(container.textContent).not.toContain('四个工具默认全部注册')
    expect(container.textContent).not.toContain('enabledTools')
    expect(container.textContent).not.toContain('过滤展示文件名')
    expect(container.textContent).toContain('{author}')
    expect(container.textContent).toContain('{pages}')
    expect(container.textContent).not.toContain('{{name}}')
    expect(app.current()).toEqual({})
  })
  it('卡片选项独占标题下方整行，不与标题竞争横向空间', async () => {
    await mount()
    const row = container.querySelector('[data-schema-path="fileMethod"] [data-schema-field-row]')
    const body = row?.querySelector(':scope > .col-span-full')
    expect(body?.classList.contains('row-start-2')).toBe(true)
    expect(body?.className).not.toContain('schema-field:row-start-1')
    expect(body?.className).not.toContain('schema-field:col-span-1')
  })
  it('已保存值回显，切换值与语言保留其他配置', async () => {
    const app = await mount({ fileMethod: 'file', cache: false })
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.closest('label')?.htmlFor).toContain('file')
    for (const mode of ['url', 'buffer', 'file']) {
      const control = container.querySelector(`label[for$="-${mode}"] [role="radio"]`)
      if (!control) throw new Error('Missing radio')
      await act(async () => control.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      expect(app.current()).toEqual({ fileMethod: mode, cache: false })
    }
    await act(async () => app.context.locale.setLocale('en'))
    expect(container.textContent).toContain('same absolute path')
    expect(app.current()).toEqual({ fileMethod: 'file', cache: false })
  })
  it('卸载清理专属扩展，不污染宿主表单', async () => {
    await mount()
    expect(extensionOf(schema, 'file')?.component).toBe(FileMethodField)
    await act(async () => root?.unmount())
    root = undefined
    await ctx?.fiber.dispose()
    expect(extensionOf(schema, 'file')?.component).not.toBe(FileMethodField)
  })
})
