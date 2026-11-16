# dsh-restart-account

A restart entry for the DeepSeek Harness desktop app, placed in the sidebar account menu: open the bottom-left user menu and **重启 DSH / Restart DSH** sits directly below **退出登录 / Sign out**, with the same font size, colour and row height as the items above it.

Clicking it asks for confirmation, then closes the app and starts it again. That is what makes newly installed or updated plugins (and other Host-side changes) take effect without hunting for the window and relaunching by hand.

## Why

After installing a plugin, DSH usually reports that a restart is required. Until now the only ways to restart were closing the window from the taskbar and reopening it, or using a developer-only menu item that is not part of a packaged build. This plugin puts the action where you already are when you change account-level settings.

## Usage

1. Click your avatar (or the `…` button when signed out) at the bottom-left of the sidebar.
2. The menu shows **设置 / Settings**, **意见反馈 / Feedback**, **退出登录 / Sign out**, and **重启 DSH / Restart DSH**.
3. Click **重启 DSH**, confirm, and the app closes and reopens on its own.

## What it does

- Asks the desktop app's window to close normally; if it has not exited within 6 seconds, the main process is terminated.
- Waits for the Host process to finish, then starts the same executable that is running the app.
- Writes a step-by-step journal to `%TEMP%\dsh-restart.log`, so a failed restart can be diagnosed afterwards.
- Never shows a console window: the relauncher is a `.vbs` host started through WMI, which runs PowerShell with its window hidden from creation, and it lives outside the app's process tree so it survives the shutdown it triggers.
- If the app has not gone away within 12 seconds, the confirmation dialog stops saying “restarting” and shows the journal path plus a retry button instead of hanging.

The menu row only appears on the desktop app. In a browser session (`dsh web`) there is no Electron main process to relaunch, so the entry is hidden.

## Requirements

- DeepSeek Harness desktop app (`@deepseek-ai/dsh-desktop`) with the client-side account menu plugin, i.e. any regular 0.2.x desktop install.
- Windows, macOS or Linux. The Windows path uses WMI + `wscript.exe`; other platforms use a `sh` helper with `kill`/`exec`.

## Install

From the DSH plugin market: search for **重启 DSH** / **Restart DSH**, install, then restart once (with this plugin you can use its own menu item after a manual restart).

From npm:

```bash
dsh plugin add dsh-restart-account
```

From source, as a local bundle:

```bash
dsh plugin add C:\path\to\dsh-restart-account
```

Either way the bundle is enabled by `cordis.patch.yml`, which inserts the plugin as `dsh-restart-account`.

## Configuration

None. No settings, no network access, no telemetry. The only host routes it registers are local ones under `/restart-dsh/`:

| Route | Purpose |
| --- | --- |
| `GET /restart-dsh/status` | Reports whether a restart is possible and the pids/exe involved. |
| `POST /restart-dsh/restart` | Schedules the restart. Requires header `x-dsh-restart: 1` and a same-origin request. |
| `POST /restart-dsh/probe` | Runs the relauncher against a throwaway script, to verify the mechanism without restarting. |

`POST /restart-dsh/restart?dry=1` returns the generated script instead of running it.

All three routes first pass DSH's own admission check, `ctx.connection.requestRejection(req)` — the same Host/Origin fence and browser-credential / live-Peer check every built-in web route goes through — and answer `401` or `403` when it rejects the request. Beyond that, the two acting routes additionally require the `x-dsh-restart: 1` intent header and a same-origin request.

## Uninstall

```bash
dsh plugin remove dsh-restart-account
```

If you installed it from a local folder link, remove that link the same way. After uninstalling, the sidebar account menu returns to its original three items.

## Notes

- The account menu row is drawn by shadowing the `settings.launcher` slot at priority `-1`; the original launcher component stays registered underneath and is used again as soon as this plugin is disabled.
- This plugin and any other plugin that rewrites the same launcher cannot both be active: a single slot accepts one registration per priority.

## License

MIT
