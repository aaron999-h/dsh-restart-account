# dsh-restart-account（重启 DSH）

给 DeepSeek Harness 桌面端加一个「重启」入口：点开左下角的账号菜单，**重启 DSH** 就在 **退出登录** 下面，字体、字号、行高、悬停底色与上面三项完全一致。

点它 → 二次确认 → 应用自动关闭并重新打开。装完或更新插件后需要重启才能生效的场景，不用再去任务栏关窗口、再重新打开。

## 为什么需要

安装插件后 DSH 通常会提示需要重启。原来要么从任务栏关掉窗口再打开，要么用一个只在开发模式下出现的菜单项——打包版本里没有。这个插件把动作放在你本来就会打开的地方。

## 用法

1. 点击侧边栏左下角的头像（未登录时是 `…` 按钮）。
2. 菜单里有 **设置**、**意见反馈**、**退出登录**，以及新增的 **重启 DSH**。
3. 点击 **重启 DSH** 并确认，应用会自行关闭并重新打开。

## 具体行为

- 先请求窗口正常退出；若 6 秒内没有退出，则强制结束主进程。
- 等 Host 进程结束后，用当前正在运行的那个可执行文件重新启动应用。
- 每一步都写入 `%TEMP%\dsh-restart.log`，重启失败可以事后排查。
- 全程不弹终端窗口：启动器是一个 `.vbs` 脚本，经 WMI 创建、由 `wscript.exe` 承载，再以隐藏窗口方式运行 PowerShell；它不在应用进程树内，因此不会被自己触发的退出一起杀掉。
- 若 12 秒内应用还没退出，确认框会从「正在重启…」切换为提示信息（含日志路径）与「重试」按钮，不会一直卡住。

该菜单项只在桌面端出现。浏览器方式（`dsh web`）没有 Electron 主进程可以拉起，因此自动隐藏。

## 环境要求

- DeepSeek Harness 桌面端（`@deepseek-ai/dsh-desktop`），且包含客户端账号菜单插件，即常规的 0.2.x 桌面安装。
- Windows / macOS / Linux。Windows 使用 WMI + `wscript.exe`；其他平台使用 `sh` 助手脚本配合 `kill` / `exec`。

## 安装

插件市场：搜索「重启 DSH」/「Restart DSH」安装，然后手动重启一次（之后就可以用它自己了）。

npm：

```bash
dsh plugin add dsh-restart-account
```

本地目录：

```bash
dsh plugin add C:\path\to\dsh-restart-account
```

bundle 由 `cordis.patch.yml` 启用，插入的条目 id 为 `dsh-restart-account`。

## 配置

无配置项，不联网、不上报。Host 端只注册 `/restart-dsh/` 下的本地路由：

| 路由 | 用途 |
| --- | --- |
| `GET /restart-dsh/status` | 报告能否重启，以及涉及的主进程 / Host 进程与可执行文件路径。 |
| `POST /restart-dsh/restart` | 安排重启。需要 `x-dsh-restart: 1` 请求头且同源。 |
| `POST /restart-dsh/probe` | 用一次性脚本验证启动器链路，不会真的重启。 |

`POST /restart-dsh/restart?dry=1` 只返回生成的脚本正文。

三条路由在处理请求前都会先过 DSH 自己的准入检查 `ctx.connection.requestRejection(req)`——与所有内置 Web 路由相同的 Host/Origin 围栏与浏览器凭据 / 实时 Peer 校验——被拒时直接回 `401` / `403`。在此之上，两个会执行动作的路由还要求 `x-dsh-restart: 1` 意图头与同源请求。

## 卸载

```bash
dsh plugin remove dsh-restart-account
```

如果是用本地目录 link 安装的，同样卸载那条 link。卸载后左下角账号菜单恢复为原来的三项。

## 说明

- 账号菜单那一行是通过以 `priority: -1` 遮蔽 `settings.launcher` 槽位实现的；原启动器组件仍注册在下面，插件一停用就自动恢复。
- 本插件与任何同样改写该启动器的插件不能同时启用：单个槽位在同一个优先级上只接受一个注册。

## 许可证

MIT
