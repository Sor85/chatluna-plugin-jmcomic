// 文件路径和输出名称工具。
// 所有从 JM 标题生成的路径都必须先经过这里清理。

import { rm } from 'node:fs/promises'
import { SENSITIVE_FILE_NAME_WORDS } from './sensitive-words'

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
export function formatOutputName(template: string, name: string, id: string, index?: number) {
  return sanitizeFileName(
    template
      .split('{{name}}').join(name)
      .split('{{id}}').join(id)
      .split('{{index}}').join(index == null ? '' : String(index))
  )
}

export function filterSensitiveFileName(fileName: string) {
  let filtered = fileName
  for (const word of SENSITIVE_FILE_NAME_WORDS) {
    if (!filtered.includes(word)) continue
    filtered = filtered.split(word).join('*'.repeat(word.length))
  }
  return filtered
}

// 删除目录或文件，不存在时静默跳过。
export async function removeDirIfExists(path: string) {
  await rm(path, { recursive: true, force: true })
}
