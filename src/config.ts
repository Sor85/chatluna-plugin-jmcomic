import { Schema } from '@chatluna/schema'

export type OutputFormat = 'pdf' | 'zip'
export type FileMethod = 'buffer' | 'file' | 'url'

export interface Config {
  defaultFormat: OutputFormat
  fileMethod: FileMethod
  publicBaseUrl: string
  password: string
  fileName: string
  filterSensitiveFileName: boolean
  allowAIChangeFormat: boolean
  retryCount: number
  minimumFreeDiskMb: number
  maxDownloadPages: number
  concurrentDownloadLimit: number
  concurrentDecodeLimit: number
  concurrentTaskLimit: number
  zipLevel: number
  cache: boolean
  fileExpireHours: number
  debug: boolean
}

export const Config: Schema<Partial<Config>, Config> = Schema.intersect([
  Schema.object({
    defaultFormat: Schema.union([
      Schema.const('pdf').description('PDF 文件'),
      Schema.const('zip').description('ZIP 压缩包')
    ]).label('默认导出格式').default('pdf'),
    fileName: Schema.string().min(1).label('文件名模板')
      .description('导出文件名模板，可使用 {{name}} 和 {{id}}').default('{{name}} ({{id}})'),
    filterSensitiveFileName: Schema.boolean().label('过滤展示文件名')
      .description('发送下载结果时，用 * 替换文件名中的色情敏感词；只影响发送展示名，不修改实际文件路径').default(false),
    password: Schema.string().role('secret').label('默认密码')
      .description('PDF 和 ZIP 默认密码；留空则不加密').default(''),
    allowAIChangeFormat: Schema.boolean().label('允许 AI 临时切换格式')
      .description('允许模型更改本次导出格式；关闭时工具参数中不提供格式选项').default(true),
    zipLevel: Schema.number().min(0).max(9).step(1).label('ZIP 压缩等级')
      .description('0 最快但体积较大，9 最慢但体积较小').default(6),
    maxDownloadPages: Schema.number().min(1).max(10000).step(1).label('单本页数上限')
      .description('单个本子允许下载的最大页数').default(300),
    minimumFreeDiskMb: Schema.number().min(0).max(1048576).label('最少可用磁盘空间')
      .description('下载目录所在磁盘最少的可用空间，单位 MB；0 为关闭').default(3000),
    retryCount: Schema.number().min(1).max(10).step(1).label('请求重试次数')
      .description('JMComic API 和图片下载失败时，每个域名的最大尝试次数').default(5)
  }).description('下载与导出'),
  Schema.object({
    fileMethod: Schema.union([
      Schema.const('buffer').description('通过消息缓冲发送文件'),
      Schema.const('file').description('通过本地文件路径发送文件'),
      Schema.const('url').description('生成 HTTP(S) 文件链接并返回给模型')
    ]).role('jmcomic:file-method').label('文件传输方式').default('buffer'),
    publicBaseUrl: Schema.string().role('link').label('公开基础地址')
      .description('HTTP(S) 文件链接的公开基础地址，留空时使用 ChatLuna server.baseUrl；必须是接收方可访问的地址').default(''),
    cache: Schema.boolean().label('保留下载缓存')
      .description('保留原图、解密图和导出文件；关闭时在发送后删除，链接模式仍保留至有效期结束').default(true),
    fileExpireHours: Schema.number().min(1).max(720).label('文件保留时间')
      .description('下载文件和缓存的保留小时数；下载链接在插件重启后失效').default(24)
  }).description('发送与缓存'),
  Schema.object({
    concurrentTaskLimit: Schema.number().min(1).max(5).step(1).label('整本任务并发数')
      .description('同时处理的整本下载任务数量').default(1),
    concurrentDownloadLimit: Schema.number().min(1).max(20).step(1).label('图片下载并发数')
      .description('单个下载任务内同时下载图片的最大数量').default(8),
    concurrentDecodeLimit: Schema.number().min(1).max(20).step(1).label('图片解码并发数')
      .description('单个下载任务内同时解码图片的最大数量').default(4),
    debug: Schema.boolean().label('调试日志').description('输出请求重试和下载进度，不记录文件密码与内容').default(false)
  }).description('性能与调试')
])
