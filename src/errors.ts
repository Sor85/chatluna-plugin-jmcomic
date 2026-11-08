// 插件内部错误类型。
// 用明确错误类区分用户输入、远端请求和文件生成失败。

export class InvalidInputError extends Error {}
export class AlbumNotFoundError extends Error {}
export class PhotoNotFoundError extends Error {}
export class JmRequestError extends Error {}
export class ArtifactError extends Error {}
