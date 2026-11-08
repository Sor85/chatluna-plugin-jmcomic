import type { Context } from 'cordis'

export type Logger = Pick<Context['logger'], 'info' | 'warn'>
