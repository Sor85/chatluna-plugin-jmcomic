# chatluna-plugin-jmcomic

ChatLuna v2 的 JMComic 工具插件。由 `koishi-plugin-chatluna-jmcomic` 0.0.16 迁移，使用 Cordis 4、v2 原生工具及 ui-kit 配置控件，不依赖旧版 ChatLuna、LangChain 或 Zod。

## 功能

| 工具 | 功能 |
| --- | --- |
| `jmcomic_search` | 关键词搜索，返回 ID、标题、作者、分类和简介，最多 20 条 |
| `jmcomic_browse` | 分类、时间范围、排序及分页浏览 |
| `jmcomic_info` | 本子详情、章节、页数、作者、标签、浏览量和点赞数 |
| `jmcomic_download` | 单本或批量下载，去重后最多 10 本，等待完成并返回逐本结果 |

四个工具默认全部注册。工具启用、名称与描述编辑由 **ChatLuna v2 工具管理**统一负责；插件不再提供 `enabledTools`、`searchTool`、`browseTool`、`infoTool`、`downloadTool` 配置。

保留移动端请求签名与 AES 响应解密、域名轮换与更新、图片切片重排、多章节目录、PDF 与 AES-256 ZIP 密码、敏感词展示名过滤、队列及缓存清理。不新增旧版没有的聊天命令。

## 安装与开发

当前 `@chatluna/*` 尚未发布到 npm，需要在 ChatLuna v2 workspace 中构建。

```sh
# 在本源码目录执行；可用 CHATLUNA_V2_ROOT 指向其他 v2 仓库
node scripts/sync-to-v2.mjs --once

# 在 v2 仓库根目录执行
yarn install
yarn yakumo build jmcomic

# 在 v2 external/jmcomic 目录执行
yarn typecheck
yarn test
```

本目录是唯一源码，`external/jmcomic` 只是构建运行副本，不直接编辑副本。源码目录不安装依赖、不生成锁文件。新增 Tailwind 类名后需要完整重启 `yarn dev` 的 launcher 和 worker。

在 v2 的扩展组启用：

```yaml
- id: jmcomic
  name: chatluna-plugin-jmcomic
  config: {}
```

配置通过宿主插件页的 SchemaForm 保存，文件传输选项使用 `@chatluna/ui-kit`。没有独立设置页或额外保存接口。

## 配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `defaultFormat` | `pdf` | PDF 或 ZIP |
| `fileName` | `{{name}} ({{id}})` | 导出名模板，文件名统一清理 |
| `filterSensitiveFileName` | `false` | 只过滤展示名，不改磁盘路径 |
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

### 文件传输

- **buffer**：插件读取生成文件并通过 Satori 发送内联文件；不要求与 OneBot 共享目录。
- **file**：发送 `file://` 路径。ChatLuna 和真实 OneBot 实现必须能够访问同一个绝对路径；Docker 部署需同路径挂载。此模式不会被 v2 的 Agent 媒体管线改成其他传输方式。
- **url**：返回带随机 token 的 HTTP(S) 下载链接给模型，不直接发送消息。接收方必须能访问 `publicBaseUrl` 或 `server.baseUrl`；插件重启后 token 失效。

缓存位于实例根目录的 `data/chatluna/jmcomic/album/`。同一本子的任务串行，原图复用；每次导出生成独立产物，避免旧链接被新密码或格式覆盖。`cache=false` 时 buffer/file 在投递后清理，url 仍保留到有效期结束。每小时及任务后清理，跳过活动任务。

请求同时响应调用取消与插件卸载，每次网络请求超时 30 秒；API 响应上限 8 MiB，单张图片上限 64 MiB。下载工具最长等待 15 分钟，取消后不继续发送文件。批量任务允许部分失败，不把失败项标为成功。

## 验证

单元测试包含真实 Cordis `tools.execute`、本地 HTTP 加密协议、图片解码、PDF/ZIP、缓存、取消、下载路由和真实 SchemaForm/ui-kit 挂载。测试内容全部为自行生成的中性图册，不下载实际站点内容。

完整 OneBot 沙盒矩阵在 v2 根目录运行：

```sh
node --import @oxc-node/core/register external/jmcomic/scripts/test-sandbox.mjs
```

需要 workspace 中已有 `external/onebot-sandbox`。脚本启动独立沙盒与 HTTP fixture，通过沙盒 HTTP API 投递消息，调用真实构建包的四个工具，核对 Satori 会话和 OneBot 出站记录，不调用模型；结束后停止所有临时服务，报告写入系统临时目录。

矩阵涵盖 NapCat、LLBot、SnowLuma，群聊与私聊，PDF/ZIP、明文/密码、三种传输方式及失败场景。**onebot-sandbox 按设计禁止 `file://` 本地读取**：这部分验证生成路径和明确拒绝，不代表真实 OneBot 本地文件上传已经验证；需要同路径部署的真实适配器完成最终验收。

## 迁移注意

- 不自动导入旧 Koishi 配置或缓存；迁移时复制上述业务配置，删除旧工具配置块。
- 修正旧版同时传 `albumId` 与 `albumIds` 可绕过十本上限的边界，按去重后的总数限制。
- 远端服务和域名的可用性取决于当前网络；确定性测试不作为公网可用性证明。

## 许可证

MIT。保留原插件许可证与版权声明。
