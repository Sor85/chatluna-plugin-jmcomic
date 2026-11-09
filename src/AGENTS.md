# 后端约定

适用范围：`src/`。同时遵守根 `AGENTS.md`；前后端契约涉及 `client/AGENTS.md`，测试涉及 `tests/AGENTS.md`。

- 使用 Cordis 4 生命周期和 Schema，不依赖 Koishi 或 LangChain，不引入 zod；不保留旧宿主 API、配置或参数的兼容层。JM 移动端协议的域名轮换、分类映射和图片解码分支仍属于当前功能。
- `index.ts` 仅组合配置、依赖和服务；领域客户端、导出器与队列独立于工具注册。
- 四个工具无条件注册，由 v2 统一负责可见性、权限、名称和描述编辑；不新增旧版没有的聊天命令。
- `TaskQueue.add` 只返回任务 ID，`waitForTask` 等待终态；下载工具同步等待完成，不维护旧排队位置或超时返回中间态。导出仅覆盖目录 ZIP 和图片 PDF。
- 文件名模板使用单花括号；`utils/file.ts` 的 `formatOutputName` 从本子实体一次性替换 `{name}`、`{id}`、`{author}`、`{tags}`、`{actors}`、`{chapters}`、`{pages}` 后清理非法字符，不递归解析元数据中的占位符。数组以顿号分隔，空数组留空；章节数与页数以实际下载的 `photos` 为准。
- 文件投递从 `call.routeId` 取得可信入站会话。附件标题、下载响应头和工具结果使用同一导出文件名，不另行改写展示名。插件生成的 buffer/file 经 Satori `bot.sendMessage`（携带原 session） 原样发送，避免 `chat.send` 将 file:// 当作 Agent 机器路径重新读取并改成内联数据；模型不能指定任意接收人或文件路径。网络和任务响应插件卸载及调用取消。
- 同一本子的任务串行，失败等待其他 worker 停止后才清理。产物使用唯一目录，旧 URL 不会因新密码或格式重导出而指向新文件。
- `cache=false` 时发送后删除缓存，URL 模式仍保留到 TTL；清理跳过活动任务，token 和队列是内存状态。
- 配置只从 `apply(ctx, config)` 获取；SchemaForm 内嵌控件通过宿主默认配置保存链路落盘，不另写 YAML 或保存 API。
