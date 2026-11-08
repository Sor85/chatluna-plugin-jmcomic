# AGENTS.md — chatluna-plugin-jmcomic

ChatLuna v2 外部插件，由 `koishi-plugin-chatluna-jmcomic` 迁移，协议 MIT。保留 JMComic 移动端协议与四个模型工具，不添加旧版没有的聊天命令；工具开关、名称和描述编辑统一由 v2 管理，不再增加插件级工具配置。

## 开发与验证

- 本目录是唯一源码；通过 `node scripts/sync-to-v2.mjs --once` 单向同步到 ChatLuna v2 仓库的 `external/jmcomic`。不要直接编辑副本。
- 默认 v2 路径为 `../../chatluna-v2-mirror`，可用 `CHATLUNA_V2_ROOT` 指定。源码目录不安装依赖、不保存锁文件；脚本直接用 node 执行。
- 在 v2 根目录运行 `yarn yakumo build jmcomic`；在 `external/jmcomic` 运行 `../../node_modules/.bin/vitest run`，以及 `../../node_modules/.bin/tsc -p tsconfig.json --noEmit`、`../../node_modules/.bin/tsc -p tsconfig.client.json --noEmit`。
- 新增 Tailwind 类或修改构建产物后，验证前完整重启共享开发服务，先协调其他使用者；停止 launcher 和 worker 并确认端口释放。
- 不自动提交、创建分支或发布。v2 依赖未公开发布时仅在本地 workspace 构建。

## 数据与安全

- 测试仅使用隔离的 onebot-sandbox 测试空间和无敏感内容的本地 API 固件，不修改真实会话、用户、权限或预设。
- 凭据不写入源码、测试报告或日志；测试端点通过环境变量传入凭据。
- 移动端协议、域名轮换与图片解码沿用旧版；测试用注入的 HTTP transport 返回自行生成的数据。只管理自己的下载缓存，不删除其他目录的数据。

## 子目录说明

- `src/AGENTS.md`：后端 API、工具、文件投递与配置契约。
- `client/AGENTS.md`：v2 ui-kit 设置页、文案和状态同步。
- `tests/AGENTS.md`：领域与接入回归测试、沙盒验证边界。
