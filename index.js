/**
 * Host half of the restart bundle.
 *
 * The renderer cannot relaunch the Desktop app by itself: only the Electron
 * main process owns `app.relaunch()`, and no IPC channel exposes it to pages or
 * plugins. This half therefore publishes a small local route on the Host's own
 * web server and, on request, hands the close-and-relaunch job to a helper that
 * lives outside this process tree.
 *
 * The helper is started through WMI (`Win32_Process.Create`) instead of a plain
 * `child_process.spawn`: a WMI-spawned process is owned by the WMI service
 * provider host, so it keeps running while the app it is replacing shuts down.
 * Every step is journaled to `%TEMP%\dsh-restart.log`, so a failed restart always
 * leaves evidence behind.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Services this Host half needs. */
export const inject = ['webServer']

/** Route prefix owned by this plugin. */
const PREFIX = '/restart-dsh'
/** Header a same-origin page sends with the restart request. */
const INTENT_HEADER = 'x-dsh-restart'
/** Delay before the helper starts, so the HTTP response can be flushed. */
const ARM_DELAY_MS = 120
/** How long an accepted request blocks a second one before it may be retried. */
const ARM_COOLDOWN_MS = 20000

/**
 * Whether this Host runs inside the Desktop app. The Desktop spawns the Host
 * as a child process with an IPC channel; a plain `dsh web` Host has none.
 * @returns whether relaunching the app is meaningful here.
 */
function desktopHost() {
  return typeof process.send === 'function' && typeof process.execPath === 'string'
}

/**
 * @param res - response to complete.
 * @param status - HTTP status code.
 * @param body - JSON body.
 */
function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * Quote one value as a PowerShell single-quoted literal.
 * @param value - raw text.
 * @returns the quoted literal.
 */
function psQuote(value) {
  return `'${String(value).replace(/'/gu, "''")}'`
}

/**
 * PowerShell helper that closes the Electron main process and starts it again.
 * Closing the main process stops the Host by itself: the Host shuts down when
 * its IPC channel disconnects.
 * @param options - process facts sampled when the restart was requested.
 * @returns the script body.
 */
function powershellHelper({ mainPid, hostPid, exe, logPath }) {
  return `param()
$ErrorActionPreference = 'SilentlyContinue'
$mainPid = ${mainPid}
$hostPid = ${hostPid}
$logPath = ${psQuote(logPath)}
function Write-Log([string]$message) { '{0:HH:mm:ss.fff} helper: {1}' -f (Get-Date), $message | Out-File -FilePath $logPath -Append -Encoding utf8 }
Write-Log "helper started (main=$mainPid host=$hostPid exe=$([System.Diagnostics.Process]::GetCurrentProcess().Id))"
Start-Sleep -Milliseconds 700
$main = Get-Process -Id $mainPid -ErrorAction SilentlyContinue
if ($null -ne $main) {
  Write-Log 'asking the app window to close'
  $null = $main.CloseMainWindow()
  for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Milliseconds 250
    if ($null -eq (Get-Process -Id $mainPid -ErrorAction SilentlyContinue)) { break }
  }
  if ($null -ne (Get-Process -Id $mainPid -ErrorAction SilentlyContinue)) {
    Write-Log 'app window did not close, terminating the app process'
    Stop-Process -Id $mainPid -Force
  }
}
for ($i = 0; $i -lt 80; $i++) {
  if ($null -eq (Get-Process -Id $hostPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}
Write-Log 'relaunching'
Start-Sleep -Milliseconds 600
$started = Start-Process -FilePath ${psQuote(exe)} -PassThru
if ($null -eq $started) { Write-Log 'relaunch failed: Start-Process returned nothing' }
else { Write-Log "relaunch issued (pid=$($started.Id))" }
`
}

/**
 * Harmless helper used by the probe route: proves that this Host can start a
 * helper process at all, without touching the running app.
 * @param logPath - journal the probe writes to.
 * @returns the script body.
 */
function powershellProbe(logPath) {
  return `param()
$ErrorActionPreference = 'SilentlyContinue'
$logPath = ${psQuote(logPath)}
'{0:HH:mm:ss.fff} probe: helper alive (pid={1} ppid={2})' -f (Get-Date), $PID, (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId | Out-File -FilePath $logPath -Append -Encoding utf8
Start-Sleep -Milliseconds 400
'{0:HH:mm:ss.fff} probe: helper finished' -f (Get-Date) | Out-File -FilePath $logPath -Append -Encoding utf8
`
}

/**
 * POSIX helper with the same responsibilities as the PowerShell one.
 * @param options - process facts sampled when the restart was requested.
 * @returns the script body.
 */
function posixHelper({ mainPid, hostPid, exe, logPath }) {
  const log = (message) => `printf '%s helper: %s\\n' "$(date +%H:%M:%S.%3N)" ${psQuoteShell(message)} >> ${psQuoteShell(logPath)}\n`
  return `#!/bin/sh
sleep 1
${log('helper started')}kill -TERM ${mainPid} 2>/dev/null
i=0
while kill -0 ${mainPid} 2>/dev/null && [ "$i" -lt 40 ]; do sleep 0.25; i=$((i+1)); done
kill -KILL ${mainPid} 2>/dev/null
i=0
while kill -0 ${hostPid} 2>/dev/null && [ "$i" -lt 80 ]; do sleep 0.25; i=$((i+1)); done
${log('relaunching')}sleep 1
'${exe.replace(/'/gu, "'\\''")}' >/dev/null 2>&1 &
${log('relaunch issued')}`
}

/**
 * Quote one value as a POSIX shell single-quoted literal.
 * @param value - raw text.
 * @returns the quoted literal.
 */
function psQuoteShell(value) {
  return `'${String(value).replace(/'/gu, "'\\''")}'`
}

/**
 * Append one journal line; journaling never fails the request.
 * @param logPath - journal file.
 * @param message - one-line message.
 */
function journal(logPath, message) {
  try {
    appendFileSync(logPath, `${new Date().toISOString().slice(11, 23)} host: ${message}\n`, 'utf8')
  } catch (_error) {
    // A missing journal must not break the restart attempt.
  }
}

/**
 * Create one process through the WMI service, outside this process tree.
 * @param commandLine - full command line of the process to create.
 * @param logPath - journal file.
 * @returns a promise resolving to the launcher's report.
 */
function launchThroughWmi(commandLine, logPath) {
  const remote = [
    'Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ',
    psQuote(commandLine),
    " } | ForEach-Object { 'rc={0} pid={1}' -f $_.ReturnValue, $_.ProcessId }",
  ].join('')
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', remote,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd: tmpdir() })
    let output = ''
    let settled = false
    const finish = (report) => {
      if (settled) return
      settled = true
      resolve(report)
    }
    child.stdout?.on('data', (chunk) => { output += chunk })
    child.stderr?.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => {
      journal(logPath, `wmi launcher spawn failed (${error?.code ?? 'unknown'}: ${error?.message ?? error})`)
      finish({ ok: false, via: 'wmi', output: String(error?.message ?? error) })
    })
    child.on('exit', (code, signal) => {
      const text = output.trim()
      journal(logPath, `wmi launcher exited code=${code} signal=${signal ?? 'none'} output=${text.slice(0, 400)}`)
      finish({ ok: /rc=0 pid=\d+/u.test(text), via: 'wmi', output: text })
    })
  })
}

/**
 * Write the console-less Windows launcher for one PowerShell payload.
 *
 * `wscript.exe` is a GUI-subsystem host, and `WScript.Shell.Run(..., 0, False)`
 * starts the payload with a hidden window, so the helper never shows a console
 * window — neither while it waits nor while it replaces the app.
 * @param scriptPath - PowerShell payload to run.
 * @returns the launcher path.
 */
function writeWindowsLauncher(scriptPath) {
  const command = `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`
  const launcher = join(tmpdir(), `dsh-restart-${Date.now()}.vbs`)
  writeFileSync(launcher, [
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run "${command.replace(/"/gu, '""')}", 0, False`,
    '',
  ].join('\r\n'), 'utf8')
  return launcher
}

/**
 * Windows command line that starts one script without a console window.
 * @param scriptPath - PowerShell payload to run.
 * @returns the launcher path and the command line that starts it.
 */
function windowsInvocation(scriptPath) {
  const launcher = writeWindowsLauncher(scriptPath)
  const wscript = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe')
  return { launcher, commandLine: `"${wscript}" //nologo "${launcher}"` }
}

/**
 * Start one command as a detached child of this Host. Used only when WMI is
 * unavailable; it may not survive the app shutdown it triggers.
 * @param command - executable to start.
 * @param args - its arguments.
 * @param logPath - journal file.
 * @returns the launcher's report.
 */
function launchDetached(command, args, logPath) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: tmpdir() })
  child.on('error', (error) => {
    journal(logPath, `detached helper spawn failed (${error?.code ?? 'unknown'}: ${error?.message ?? error})`)
  })
  child.on('exit', (code, signal) => {
    journal(logPath, `detached helper exited code=${code} signal=${signal ?? 'none'}`)
  })
  child.unref()
  journal(logPath, `detached helper started pid=${child.pid}`)
  return { ok: child.pid !== undefined, via: 'detached', output: `pid=${child.pid}` }
}

/**
 * Start a helper script outside this process tree, preferring WMI.
 *
 * On Windows the script is started through a `wscript.exe` launcher so the
 * helper never opens a console window.
 * @param scriptPath - script to run.
 * @param logPath - journal file.
 * @returns a promise resolving to the launcher's report.
 */
async function launchHelper(scriptPath, logPath) {
  if (process.platform !== 'win32') return launchDetached('/bin/sh', [scriptPath], logPath)
  const invocation = windowsInvocation(scriptPath)
  journal(logPath, `launcher written ${invocation.launcher}`)
  const wscript = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe')
  const report = await launchThroughWmi(invocation.commandLine, logPath)
  if (report.ok) return report
  journal(logPath, 'wmi launch did not report a process, falling back to a detached child')
  return launchDetached(wscript, ['//nologo', invocation.launcher], logPath)
}

/**
 * Publish the restart routes for one Host.
 * @param ctx - Host plugin context carrying the web server service.
 */
export function apply(ctx) {
  const desktop = desktopHost()
  const mainPid = process.ppid
  const exe = process.execPath
  const logPath = join(tmpdir(), 'dsh-restart.log')
  const allowedOrigins = new Set(['dsh-app://app'])
  try {
    const origin = ctx.webServer.getOrigin?.()
    if (typeof origin === 'string' && origin !== '') allowedOrigins.add(origin)
  } catch (_error) {
    // A Host without a bound origin still serves local requests without one.
  }
  let armedAt = 0

  /**
   * @param req - incoming request.
   * @returns whether the request may act on this route.
   */
  const sameOrigin = (req) => {
    const origin = req.headers.origin
    return origin === undefined || allowedOrigins.has(origin)
  }

  /**
   * Shared guard for the two acting routes.
   * @param req - incoming request.
   * @returns the rejection to send, or undefined when the request may proceed.
   */
  const rejection = (req) => {
    if (req.method !== 'POST') return [405, 'method-not-allowed']
    if (req.headers[INTENT_HEADER] !== '1' || !sameOrigin(req)) return [403, 'forbidden']
    if (!desktop) return [409, 'not-desktop']
    return undefined
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/status`,
    handler: (_req, res) => {
      json(res, 200, {
        desktop,
        supported: desktop,
        armed: armedAt !== 0 && Date.now() - armedAt < ARM_COOLDOWN_MS,
        exe,
        mainPid,
        hostPid: process.pid,
        platform: process.platform,
        logPath,
      })
    },
  }), 'restart-dsh: status route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/restart`,
    handler: (req, res) => {
      const denied = rejection(req)
      if (denied !== undefined) {
        json(res, denied[0], { ok: false, error: denied[1] })
        return
      }
      const armed = armedAt !== 0 && Date.now() - armedAt < ARM_COOLDOWN_MS
      if (armed) {
        json(res, 409, { ok: false, error: 'already-armed' })
        return
      }
      const options = { mainPid, hostPid: process.pid, exe, logPath }
      const search = new URL(req.url ?? '/', 'http://localhost').searchParams
      const scriptBody = process.platform === 'win32' ? powershellHelper(options) : posixHelper(options)
      if (search.get('dry') === '1') {
        json(res, 200, { ok: true, dry: true, script: scriptBody, logPath })
        return
      }
      const script = join(tmpdir(), `dsh-restart-${Date.now()}${process.platform === 'win32' ? '.ps1' : '.sh'}`)
      try {
        writeFileSync(script, scriptBody, 'utf8')
      } catch (error) {
        journal(logPath, `helper script write failed (${error?.message ?? error})`)
        json(res, 500, { ok: false, error: 'script-write-failed', logPath })
        return
      }
      armedAt = Date.now()
      journal(logPath, `restart requested (main=${mainPid} host=${process.pid} script=${script})`)
      json(res, 200, { ok: true, logPath, script })
      setTimeout(() => {
        void launchHelper(script, logPath).then((report) => {
          journal(logPath, `launcher report via=${report.via} ok=${report.ok}`)
        }).catch((error) => {
          journal(logPath, `launcher threw (${error?.message ?? error})`)
        })
      }, ARM_DELAY_MS)
    },
  }), 'restart-dsh: restart route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/probe`,
    handler: (req, res) => {
      const denied = rejection(req)
      if (denied !== undefined) {
        json(res, denied[0], { ok: false, error: denied[1] })
        return
      }
      const script = join(tmpdir(), `dsh-restart-probe-${Date.now()}.ps1`)
      try {
        writeFileSync(script, powershellProbe(logPath), 'utf8')
      } catch (error) {
        json(res, 500, { ok: false, error: `script-write-failed: ${error?.message ?? error}`, logPath })
        return
      }
      journal(logPath, `probe requested script=${script}`)
      launchHelper(script, logPath).then((report) => {
        json(res, 200, { ok: report.ok, via: report.via, output: report.output, logPath })
      }).catch((error) => {
        json(res, 500, { ok: false, error: String(error?.message ?? error), logPath })
      })
    },
  }), 'restart-dsh: probe route')
}
