# dsh-schedule-ui

DeepSeek Harness (DSH) Web 的定时任务管理界面插件：为官方 `@deepseek-ai/dsh-schedule`
定时任务引擎提供可视化入口——会话头部按钮 + 全局浮层面板 + 侧边栏「定时任务」分区，
与模型工具 `schedule_create` / `schedule_list` / `schedule_delete` 读写同一条
`schedule/change` 事件流，双入口完全互通。

## 功能

- 会话头部「定时任务」按钮：打开当前会话的任务管理面板
- 管理面板：创建（延时 / 定时 / 周期三种模式）、查看、删除任务
- 侧边栏分区：位于「新建会话」按钮下方、与「工作区」同级，展示当前会话的定时任务
  列表，随选中会话自动切换；点击任务行跳转到所属会话；收起侧边栏后退化为图标入口，
  点击直接打开管理面板
- 数据一致：UI 与 agent 工具共享同一份持久化数据（会话事件日志 `schedule/change` v1）

## 前置条件

- DSH `web` profile（`dsh web`），版本对齐 `@deepseek-ai/dsh-schedule` v0.1.1-rc.2
- 已挂载官方引擎 `@deepseek-ai/dsh-schedule`（本插件只提供 UI，不包含调度能力）

## 安装

把本包放入 profile 的 `packages/` 目录并在 `package.json` 声明 file: 依赖，
然后在 `~/.dsh/profiles/web/cordis.patch.yml` 追加组合行：

```yaml
- insert:
    - id: schedule-ui
      name: 'dsh-schedule-ui'
```

package.json 依赖示例：

```json
{
  "dependencies": {
    "dsh-schedule-ui": "file:./packages/dsh-schedule-ui"
  }
}
```

重启 `dsh web` 后生效。

## 使用

1. 界面面板：会话头部右上角「定时任务」按钮 → 管理面板
2. 侧边栏分区：展开/收起任务列表，点击任务行跳转到所属会话
3. 对话指令：直接让 agent 调用 `schedule_create` / `schedule_list` / `schedule_delete`

## 架构

| 部分 | 文件 | 说明 |
| --- | --- | --- |
| Host | `lib/index.js` | 域逻辑（fold/校验，与官方包字节级兼容）+ `/dsh-schedule-ui/{list,create,delete}` HTTP 路由 |
| Client | `lib/client.js` | 预构建 bundle（`window.__ModuleLoader__.load` 格式）：头部按钮（`conversation.session.header.actions`）、浮层面板（`shell.overlay`）、侧边栏分区（DOM 自愈注入，位于 New Session 与工作区之间） |

- UI 与 agent 工具共享同一事件流，错误码与官方一致（`invalid_prompt`、`not_future`、
  `frequency_too_high` 等）。
- 侧边栏分区采用生态惯例（dsh-task-board / dsh-ssh 的 sidebar-entry-core 模式）：
  官方 `sidebar.workspaces` 为单占位 slot，第三方插件通过 DOM 注入 + MutationObserver
  自愈方式在「新建会话」按钮与工作区浏览器之间插入分区。

## 开发说明

- `lib/client.js` 是预构建产物，当前直接编辑该文件（无打包工具链）；修改后需同步
  profile 的 `node_modules/dsh-schedule-ui` 副本并刷新页面（或重启 host）。
- `lib/index.js` 为 ES module，域逻辑移植自官方 `@deepseek-ai/dsh-schedule`，请勿
  破坏 `schedule/change` v1 协议兼容性。

## 许可证

MIT
