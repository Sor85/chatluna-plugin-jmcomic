import type { Context } from 'cordis'
import { registerReactFormExtension } from '@chatluna/ui-schema-form/client'
import { FileMethodField } from './file-method-field'
import zh from './locales/zh.yml'
import en from './locales/en.yml'

export default function apply(ctx: Context) {
  ctx.locale.register('jmcomic', { zh, en })
  ctx.effect(() => registerReactFormExtension({
    type: 'union', role: 'jmcomic:file-method', component: FileMethodField, priority: 30
  }))
}
