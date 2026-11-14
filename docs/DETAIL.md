# dsh-restart-account — 详细说明

## 它是怎么出现在菜单里的

DSH 的侧边栏左下角账号入口是一个客户端槽位 `settings.launcher`（单实例槽位）。原版由 `@deepseek-ai/dsh-client-ui-settings-account` 注册了菜单：设置、意见反馈、退出登录 / 登录。

本插件的客户端部分（`client.js`）以 **`priority: -1`** 注册同一个槽位。槽位规则是「优先级最小者渲染」，所以插件这一份接管了渲染，原版仍注册在下面：插件被禁用或卸载后，菜单立刻恢复成原来的三项。

接管后渲染的菜单项：

| 顺序 | 文案 | 行为 |
| --- | --- | --- |
| 1 | 设置 | 打开设置面板（与原来一致） |
| 2 | 意见反馈 | 打开反馈表单（与原来一致） |
| 3 | 退出登录 / 登录 | 与原版一致，含运行中任务的确认弹窗 |
| 4 | 重启 DSH | 本插件新增：二次确认后重启桌面端 |

样式没有另起一套：行高、内边距、字号、颜色、图标尺寸、悬停底色都复用原版账号菜单的规则与主题变量（`--dsw-alias-label-primary`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-menu-icon` 等），所以在浅色/深色主题下与上面几行完全一致。

账号身份（头像、用户名、登录状态）来自 `accountUi` 服务快照，变化通过 `account-ui/change` 事件推送；登录/登出动作走 `ctx.remote.account.*`，不复制账号逻辑。

## 重启是怎么执行的

1. 客户端 `POST /restart-dsh/restart`（同源 + `x-dsh-restart: 1`）。
2. Host 半记录日志、生成脚本（Windows 为 `.ps1`，其他平台为 `.sh`），然后生成一个启动器：
   - Windows：写一个 `.vbs`，内容是 `WScript.Shell.Run "powershell … -File <脚本>", 0, False`，再用 WMI（`Win32_Process Create`）创建 `wscript.exe` 运行它。
   - 其他平台：`sh` 脚本以 `setsid`/后台方式启动。
3. 为什么绕这一层：直接从应用进程里 `spawn` 的子进程属于应用进程树，应用一退出它就被一起收拾掉，重启会停在「正在重启…」。WMI 创建的进程归 `WmiPrvSE` 所有，能活过应用的退出。用 `wscript.exe` 承载则是为了不闪控制台窗口——`powershell -WindowStyle Hidden` 仍然会先由系统创建控制台再隐藏，而 `wscript` 是 GUI 子系统程序，配合 `Run(..., 0, False)` 从一开始就不创建可见窗口。
4. 脚本依次：请求窗口正常关闭 → 最多等 6 秒 → 必要则强制结束主进程 → 等 Host 进程消失 → 用同一个可执行文件重新启动。
5. 客户端 12 秒看门狗：超时后确认框显示日志路径与「重试」，不会无限等待。

日志：`%TEMP%\dsh-restart.log`（Windows），`$TMPDIR/dsh-restart.log`（其他平台）。

## 调试接口

| 请求 | 说明 |
| --- | --- |
| `GET /restart-dsh/status` | `{desktop, supported, armed, exe, mainPid, hostPid, platform}` |
| `POST /restart-dsh/restart?dry=1` | 返回将要执行的脚本正文 |
| `POST /restart-dsh/probe` | 用一次性脚本跑通启动器链路（不会重启应用） |

三个接口都只接受本机同源请求；`restart` 与 `probe` 还需要 `x-dsh-restart: 1` 请求头。20 秒内重复请求返回 `409 already-armed`。

## 限制

- 只在桌面端可用：浏览器运行方式没有 Electron 主进程，菜单项自动隐藏。
- 与其它同样以优先遮蔽 `settings.launcher` 的插件互斥（同一优先级只能有一个注册）。
- 重启会中断正在运行的会话与后台任务；确认弹窗会提示这一点。
