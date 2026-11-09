# 客户端约定

适用范围：`client/`。同时遵守根 `AGENTS.md`；设置契约遵守 `src/AGENTS.md`。

- 只为 `jmcomic:file-method` 注册 union 表单扩展，组件来自 `@chatluna/ui-kit`，通过 `extensionProps` 保留宿主 SchemaForm 默认值、撤销、验证和 JSON 编辑。
- 多行卡片选项必须使用 `extensionProps(props, children, true)` 的全宽布局：标题与操作菜单位于首行，选项在下一行占满宽度。默认的紧凑布局会让卡片挤压标题，导致中文逐字换行。
- 根容器显式声明字号与行高。不创建新滚动区域、模态窗口或保存接口；宿主滚动、焦点和指针行为不覆盖。
- 中文和英文文案同步维护在 `locales/zh.yml` 与 `locales/en.yml`，使用宿主 locale API。
- 文件传输表单只展示传输选项与对应说明，不附加工具管理说明，不显示工具启用列表或工具名称、描述编辑器。
- 配置值变更只调用 `props.onChange`，草稿和保存交给宿主管理；注册通过当前 fiber 的 effect 释放。
