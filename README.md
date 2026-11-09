# chatluna-plugin-jmcomic

为 ChatLuna 提供 JMComic 搜索、分类浏览、详情查询与 PDF/ZIP 下载功能。

## 功能

| 工具 | 功能 |
| --- | --- |
| `jmcomic_search` | 关键词搜索，返回 ID、标题、作者、分类和简介，最多 20 条 |
| `jmcomic_browse` | 分类、时间范围、排序及分页浏览 |
| `jmcomic_info` | 本子详情、章节、页数、作者、标签、浏览量和点赞数 |
| `jmcomic_download` | 单本或批量下载，去重后最多 10 本，等待完成并返回逐本结果 |

支持多章节导出、PDF 与 AES-256 ZIP 密码保护、下载队列与缓存自动清理。

## 配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `defaultFormat` | `pdf` | PDF 或 ZIP |
| `fileName` | `{name} ({id})` | 单花括号导出名模板，字段见下文，文件名统一清理 |
| `password` | 空 | PDF/ZIP 默认密码；工具传空字符串可取消本次加密 |
| `allowAIChangeFormat` | `true` | 允许模型临时改格式；关闭后移除工具的 format 参数 |
| `zipLevel` | `6` | ZIP 压缩等级 0–9 |
| `maxDownloadPages` | `300` | 单本最大页数 |
| `minimumFreeDiskMb` | `3000` | 最少剩余磁盘空间；0 关闭检查 |
| `retryCount` | `5` | 每个域名的最大尝试次数 |
| `fileMethod` | `buffer` | 文件传输方式，见下文 |
| `publicBaseUrl` | 空 | 链接模式公开地址；回退到 `server.baseUrl` |
| `cache` | `true` | 保留下载缓存 |
| `fileExpireHours` | `24` | 缓存与下载链接保留小时数 |
| `concurrentTaskLimit` | `1` | 整本任务并发数 |
| `concurrentDownloadLimit` | `8` | 单任务图片下载并发数 |
| `concurrentDecodeLimit` | `4` | 单任务图片解码并发数 |
| `debug` | `false` | 请求重试与进度日志 |

### 文件名模板

模板使用单花括号，文件扩展名按导出格式自动添加。

| 占位符 | 内容 |
| --- | --- |
| `{name}` | 本子标题 |
| `{id}` | 本子 ID |
| `{author}` | 作者 |
| `{tags}` | 标签 |
| `{actors}` | 角色 |
| `{chapters}` | 实际导出章节数 |
| `{pages}` | 实际导出总页数 |

作者、标签和角色的多值以顿号分隔，缺失时留空。例如 `{author}-{name}-{id}-{pages}页`。替换完成后统一清理非法文件名字符，消息附件、下载响应头和工具结果使用同一导出文件名。

### 文件传输

- **buffer**：读取生成的文件并通过消息缓冲发送，不要求 ChatLuna 与 OneBot 共享目录。
- **file**：发送 `file://` 路径。ChatLuna 和 OneBot 必须能够访问同一个绝对路径；Docker 部署需同路径挂载。
- **url**：返回带随机 token 的 HTTP(S) 下载链接给模型，不直接发送消息。接收方必须能访问 `publicBaseUrl` 或 `server.baseUrl`；插件重启后链接失效。

### 缓存与限制

缓存位于实例根目录的 `data/chatluna/jmcomic/album/`。同一本子的任务串行，原图复用；每次导出生成独立文件，避免已有链接被新密码或格式覆盖。`cache=false` 时 buffer/file 在投递后清理，url 仍保留到有效期结束。每小时及任务后清理过期缓存，跳过活动任务。

每次网络请求超时 30 秒，API 响应上限 8 MiB，单张图片上限 64 MiB。下载工具最长等待 15 分钟；取消调用或卸载插件后，不继续发送文件。批量下载返回逐本结果，部分失败不影响其他成功项。

## 许可证

MIT。
