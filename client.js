/**
 * Client half of the restart bundle.
 *
 * The shipped sidebar account menu owns the `settings.launcher` single slot at
 * priority 0 and its item list is hardcoded, so an extra row can only be added
 * by shadowing that registration: this module registers the same slot at
 * priority -1 (the lowest priority renders) with a launcher that reproduces the
 * shipped menu and appends one "restart DSH" row below sign-out.
 */
window.__ModuleLoader__.load({
  id: 'dsh-restart-account',
  factory(require) {
    const React = require('react')
    const P = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const { useEffect, useRef, useState } = React
    const EMPTY_ACCOUNT = { view: undefined, details: undefined, avatar: undefined, failed: false }
    /** How long the page waits for the app to disappear before calling the restart stalled. */
    const RESTART_WATCHDOG_MS = 12000

    /* ---------------------------------------------------------------- styles */

    const STYLE_ID = 'dsh-restart-account/launcher.css'
    const CSS = `
.rsm-root{position:relative;flex:1;min-width:0}
.rsm-root[data-inset='true']{margin-inline:2px}
.rsm-notifications{position:absolute;inset-inline:0;z-index:1;bottom:calc(100% + 4px)}
.rsm-anchor{width:100%}
.rsm-trigger{display:flex;align-items:center;width:100%;height:44px;gap:8px;padding:6px calc(var(--dsh-sidebar-row-padding) - var(--dsh-sidebar-paint-inset));border:0;border-inline:var(--dsh-sidebar-paint-inset) solid transparent;box-sizing:border-box;border-radius:var(--dsw-radius-md);background:transparent;background-clip:padding-box;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer;user-select:none}
.rsm-trigger[data-signed-out='false']:not([data-collapsed='true']){padding:6px;border-inline:0;background-clip:border-box}
.rsm-trigger[data-collapsed='true']{width:36px;height:36px;justify-content:center;gap:0;padding:0;border-inline:0;box-sizing:border-box}
.rsm-trigger[data-signed-out='true']:not([data-collapsed='true']){height:32px;line-height:20px;padding:6px calc(var(--dsh-sidebar-row-padding) - var(--dsh-sidebar-paint-inset))}
@media (hover:hover){.rsm-trigger:hover{background-color:var(--dsw-alias-interactive-bg-hover)}}
.rsm-avatar{display:flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;border-radius:50%;background:var(--dsw-alias-bg-skeleton);color:var(--dsw-alias-label-tertiary);overflow:hidden}
.rsm-image{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover}
.rsm-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rsm-signedOutMenu[role='menu']{min-width:124px;max-width:280px;padding:4px}
.rsm-signedOutMenu [role='menuitem']{min-height:40px;gap:8px;padding:8px 10px;border-radius:var(--dsw-radius-md);font-size:14px;line-height:22px}
.rsm-signedOutMenu [role='menuitem']>span:first-child:not(:last-child){width:16px;height:16px;color:var(--dsw-alias-menu-icon)}
.rsm-dialog{width:min(420px,calc(100vw - 48px))}
.rsm-dialogBody{padding:20px 24px 0;color:var(--dsw-alias-label-primary)}
.rsm-dialogHeader{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.rsm-dialogTitle{margin:0;font-size:16px;font-weight:500;line-height:24px}
.rsm-dialogClose{display:flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:28px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
@media (hover:hover){.rsm-dialogClose:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.rsm-dialogText{margin:0;font-size:13px;line-height:22px;color:var(--dsw-alias-label-secondary)}
.rsm-dialogError{margin:8px 0 0;font-size:13px;line-height:22px;color:var(--dsw-alias-state-error-primary)}
.rsm-dialogNote{margin:8px 0 0;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11px;line-height:18px;word-break:break-all;color:var(--dsw-alias-label-tertiary)}
.rsm-dialogActions{display:flex;justify-content:flex-end;gap:8px;padding:20px 24px 20px}
.rsm-dialogSecondary,.rsm-dialogPrimary{min-width:88px}
.rsm-link{padding:0;border:0;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;cursor:pointer;text-decoration:underline}
.rsm-link:disabled{color:var(--dsw-alias-label-tertiary);cursor:default;text-decoration:none}
.rsm-spinner{animation:rsm-spin 1s linear infinite}
@keyframes rsm-spin{to{transform:rotate(360deg)}}
`
    if (typeof document !== 'undefined'
      && document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-restart-account'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }
    const css = {
      root: 'rsm-root', notifications: 'rsm-notifications', anchor: 'rsm-anchor', trigger: 'rsm-trigger',
      avatar: 'rsm-avatar', image: 'rsm-image', label: 'rsm-label', signedOutMenu: 'rsm-signedOutMenu',
      dialog: 'rsm-dialog', dialogBody: 'rsm-dialogBody', dialogHeader: 'rsm-dialogHeader',
      dialogTitle: 'rsm-dialogTitle', dialogClose: 'rsm-dialogClose', dialogText: 'rsm-dialogText',
      dialogError: 'rsm-dialogError', dialogActions: 'rsm-dialogActions',
      dialogNote: 'rsm-dialogNote',
      dialogSecondary: 'rsm-dialogSecondary', dialogPrimary: 'rsm-dialogPrimary',
      link: 'rsm-link', spinner: 'rsm-spinner',
    }

    /* ---------------------------------------------------------------- locale */

    const en = {
      settings: 'Settings', contactUs: 'Feedback', menu: 'Account menu', more: 'More',
      signedIn: 'Signed in to DeepSeek', signIn: 'Sign in', signOut: 'Sign out', cancel: 'Cancel', close: 'Close',
      modelSignInRequired: 'Model unavailable. Please sign in and try again.',
      sessionExpired: 'You have signed out of your account, please log in again.',
      signOutDescription: 'Signing out will not delete any data. You can sign in to this account again.',
      signOutRunningDescription: 'Tasks are currently running. Signing out will interrupt them. Sign out now?',
      signOutUnknownDescription: 'Could not check running tasks. Signing out may interrupt tasks using this account. Sign out now?',
      addApiKey: 'Add API Key', retry: 'Sign in again',
      loginTitle: 'Get started',
      loginDescription: 'Sign in to your DeepSeek account or add an API Key to get started. Your projects and files are stored locally.',
      browserTitle: 'Waiting for sign in', browserPrompt: 'Page did not open automatically? ',
      copyLink: 'Copy sign-in link', copiedLink: 'Link copied', copyFailed: 'Copy failed',
      browserDescription: ', then open it in your browser to finish signing in.',
      timeoutTitle: 'Sign in timed out', timeoutDescription: 'Sign in again to continue.',
      failureTitle: 'Could not sign in', failed: 'Could not complete the operation. Try again.',
      noResponse: 'Something went wrong. Please check your network connection and try again.',
      initializing: 'Starting sign in…', waiting: 'Continue in your browser', completing: 'Completing sign in…',
      expired: 'Sign in expired. Try again.',
      restartDsh: 'Restart DSH', restartTitle: 'Restart DeepSeek Harness',
      restartDescription: 'The app closes and starts again. Running tasks and terminal sessions are interrupted; the chat history is kept.',
      restartConfirm: 'Restart now', restarting: 'Restarting DeepSeek Harness…',
      restartFailed: 'Could not restart the app. Quit and start it again manually.',
      restartStalled: 'The app did not restart on its own. The log below explains what happened — try again, or quit the app manually.',
      retryRestart: 'Try again',
    }
    const zh = {
      settings: '设置', contactUs: '意见反馈', menu: '账号菜单', more: '更多',
      signedIn: '已登录 DeepSeek', signIn: '登录', signOut: '退出登录', cancel: '取消', close: '关闭',
      modelSignInRequired: '当前模型暂不可用，请登录后再试',
      sessionExpired: '登录信息已失效，请重新登录',
      signOutDescription: '退出登录不会丢失任何数据，你仍可以登录此账号。',
      signOutRunningDescription: '当前有进程正在执行中，点击“退出登录”，将会打断进程，是否即刻退出登录？',
      signOutUnknownDescription: '暂时无法确认任务状态。退出登录可能会中断使用此账号的任务，是否继续？',
      addApiKey: '添加 API Key', retry: '重新登录',
      loginTitle: '开始使用',
      loginDescription: '登录 DeepSeek 账号，或添加 API Key，即可开始使用。你的项目和文件保存在本地。',
      browserTitle: '等待登录', browserPrompt: '没有自动打开新页面？',
      copyLink: '复制登录链接', copiedLink: '链接已复制', copyFailed: '复制失败',
      browserDescription: '，手动打开登录页完成登录。',
      timeoutTitle: '登录已超时', timeoutDescription: '请重新登录后继续操作。',
      failureTitle: '登录失败', failed: '操作未完成，请重试。',
      noResponse: '操作未完成，可能是网络异常，请检查你的网络状况后重试',
      initializing: '正在发起登录…', waiting: '请在浏览器中继续', completing: '正在完成登录…',
      expired: '登录已过期，请重试。',
      restartDsh: '重启 DSH', restartTitle: '重启 DeepSeek Harness',
      restartDescription: '应用将关闭并重新启动。正在执行的任务与终端会话会中断，聊天记录不会丢失。',
      restartConfirm: '立即重启', restarting: '正在重启 DeepSeek Harness…',
      restartFailed: '重启失败，请手动退出并重新打开应用。',
      restartStalled: '应用没有自动重启。下面是诊断日志，你可以重试，或手动退出应用后重新打开。',
      retryRestart: '重试',
    }

    /* ------------------------------------------------------------- fragments */

    /** Sign-out glyph: a door and an arrow leaving it. */
    function LogoutIcon() {
      return h('span', { style: { width: 16, height: 16, position: 'relative' }, 'aria-hidden': 'true' },
        h('svg', {
          style: { position: 'absolute', left: 1.2, top: 1.2 }, width: 13.7, height: 13.6,
          viewBox: '0 0 14 14', fill: 'none',
        },
        h('path', {
          fill: 'currentColor',
          d: 'M4 1.4a.63.63 0 0 1 .63.63v9.94A.63.63 0 0 1 4 12.6H2.6a1.7 1.7 0 0 1-1.7-1.7V3.73a1.7 1.7 0 0 1 1.7-1.7H4Zm0 1.26H2.6a.44.44 0 0 0-.44.44v7.16c0 .24.2.44.44.44H4V2.66Z',
        }),
        h('path', {
          fill: 'currentColor',
          d: 'M9.02 3.74a.63.63 0 0 1 .9 0l2.9 2.9a.63.63 0 0 1 0 .9l-2.9 2.9a.63.63 0 1 1-.9-.9l1.82-1.8H6.16a.63.63 0 1 1 0-1.26h4.68L9.02 4.64a.63.63 0 0 1 0-.9Z',
        })))
    }

    /** Account picture with the shipped icon fallback. */
    function Avatar({ account }) {
      const [broken, setBroken] = useState(false)
      const avatar = account.avatar
      if (avatar === undefined || avatar.status !== 'ready' || broken) return h(P.IconUserOutlineMedium, { size: 16 })
      return h('img', {
        className: css.image, src: avatar.url, alt: '', referrerPolicy: 'no-referrer',
        onError: () => { setBroken(true) },
      })
    }

    /** @returns one dialog frame shared by the three confirmations. */
    function Dialog({ title, children, actions, onClose, className }) {
      return h(P.Modal, { open: true, headless: true, title, onClose, className: `${css.dialog} ${className ?? ''}` },
        h('div', { className: css.dialogBody },
          h('div', { className: css.dialogHeader },
            h('h2', { className: css.dialogTitle }, title),
            h('button', { type: 'button', className: css.dialogClose, 'aria-label': 'close', onClick: onClose },
              h(P.IconCloseOutlineRegular, { size: 14 }))),
          children),
        h('div', { className: css.dialogActions }, actions))
    }

    /** Questionnaire link that keeps only the fields the public form reads. */
    function contactUrl(config, context) {
      const url = new URL(config.contactFormUrl
        ?? 'https://trtgsjkv6r.feishu.cn/share/base/form/shrcnlCoGElW7MQznGy9r3YYXcg?hide_uid=1&hide_device_info=1&hide_harness_version=1')
      const screen = context.width > 0 && context.height > 0
        ? `screen_resolution=${Math.round(context.width * context.pixelRatio)}x${Math.round(context.height * context.pixelRatio)}`
        : undefined
      const deviceInfo = [context.deviceInfo, screen].filter(Boolean).join('; ')
      const fields = {
        uid: context.uid, source: config.contactSource, harness_version: context.version, device_info: deviceInfo,
      }
      for (const [name, value] of Object.entries(fields)) {
        url.searchParams.set(`hide_${name}`, '1')
        url.searchParams.delete(`prefill_${name}`)
        if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(`prefill_${name}`, String(value))
      }
      for (const name of ['os_version', 'device_brand', 'app_locale', 'screen_resolution', 'app_version', 'device_model']) {
        url.searchParams.delete(`prefill_${name}`)
        url.searchParams.delete(`hide_${name}`)
      }
      return url.href
    }

    /** Restart confirmation; the page dies shortly after it is accepted. */
    function RestartDialog({ t, busy, failed, stalled, logPath, onCancel, onRetry, onConfirm }) {
      const retry = stalled === true
      return h(Dialog, {
        title: t('restartTitle'),
        onClose: busy ? () => {} : onCancel,
        actions: [
          h(P.Button, {
            key: 'cancel', variant: 'outline', className: css.dialogSecondary,
            disabled: busy, onClick: onCancel,
          }, t('cancel')),
          h(P.Button, {
            key: 'confirm', variant: 'primary', className: css.dialogPrimary, disabled: busy,
            onClick: retry ? onRetry : onConfirm,
          }, t(retry ? 'retryRestart' : 'restartConfirm')),
        ],
      },
      h('p', { className: css.dialogText }, t(busy ? 'restarting' : retry ? 'restartStalled' : 'restartDescription')),
      failed && h('p', { className: css.dialogError, role: 'alert' }, t('restartFailed')),
      logPath !== undefined && logPath !== '' && (failed || retry)
        ? h('p', { className: css.dialogNote, role: 'status' }, logPath)
        : null)
    }

    /** Sign-out confirmation with the current task impact, mirroring the shipped dialog. */
    function SignOutDialog({ t, running, busy, failed, onCancel, onConfirm }) {
      return h(Dialog, {
        title: t('signOut'),
        onClose: busy ? () => {} : onCancel,
        actions: [
          h(P.Button, { key: 'cancel', variant: 'outline', className: css.dialogSecondary, disabled: busy, onClick: onCancel }, t('cancel')),
          h(P.Button, { key: 'confirm', variant: 'primary', className: css.dialogPrimary, disabled: busy, onClick: onConfirm }, t('signOut')),
        ],
      },
      h('p', { className: css.dialogText },
        t(running === 'unknown' ? 'signOutUnknownDescription' : running ? 'signOutRunningDescription' : 'signOutDescription')),
      failed && h('p', { className: css.dialogError, role: 'alert' }, t('failed')))
    }

    /** Browser sign-in dialog, mirroring the shipped attempt-state copy and actions. */
    function SignInDialog({ account, colorScheme, t, start, cancel, close, useApiKey }) {
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState(false)
      const [copyResult, setCopyResult] = useState(null)
      const attempt = account.view?.attempt
      const authorizeUrl = attempt?.authorizeUrl
      const phase = attempt?.phase
      useEffect(() => { setCopyResult(null) }, [attempt?.id, authorizeUrl])
      useEffect(() => {
        if (copyResult === null) return undefined
        const timer = setTimeout(() => { setCopyResult(null) }, 2000)
        return () => { clearTimeout(timer) }
      }, [copyResult])
      const active = busy || phase === 'initializing' || phase === 'waiting-browser' || phase === 'exchanging' || phase === 'committing'
      const expired = phase === 'expired'
      const localFailure = failed || account.loginFailed || account.failed
      const error = localFailure || phase === 'failed'
      const failureKey = !localFailure && phase === 'failed' && attempt?.errorCode === 'no-response' ? 'noResponse' : 'failed'
      const waiting = active && !error
      const committing = phase === 'committing'
      useEffect(() => { if (account.view?.status === 'credential-stored') close() }, [account.view?.status, close])
      const run = async (action) => {
        setBusy(true)
        setFailed(false)
        try { await action() } catch (_error) { setFailed(true) } finally { setBusy(false) }
      }
      const dismiss = () => {
        if (committing || busy) return
        if (active && attempt) void run(async () => { await cancel(attempt.id); close() })
        else close()
      }
      const retry = async () => {
        if (active && attempt) await cancel(attempt.id)
        await start()
      }
      const copyLink = async (url) => {
        try {
          const target = new URL(url)
          target.searchParams.set('theme', colorScheme)
          await navigator.clipboard.writeText(target.href)
          setCopyResult('copiedLink')
        } catch (_error) { setCopyResult('copyFailed') }
      }
      const title = error ? t('failureTitle') : active ? t('browserTitle') : expired ? t('timeoutTitle') : t('loginTitle')
      return h(Dialog, {
        title,
        onClose: dismiss,
        actions: [
          h(P.Button, {
            key: 'secondary', variant: 'outline', className: css.dialogSecondary, disabled: committing || busy,
            onClick: active ? dismiss : useApiKey,
          }, t(active ? 'cancel' : 'addApiKey')),
          h(P.Button, {
            key: 'primary', variant: 'primary', className: css.dialogPrimary,
            disabled: busy || committing || waiting || account.view === undefined,
            onClick: () => { void run(retry) },
          }, waiting ? h(P.IconLoadingOutlineRegular, { size: 14, className: css.spinner }) : t(expired || error ? 'retry' : 'signIn')),
        ],
      },
      waiting
        ? h('p', { className: css.dialogText }, t('browserPrompt'),
          h('button', {
            type: 'button', className: css.link, disabled: authorizeUrl === undefined,
            onClick: authorizeUrl === undefined ? undefined : () => { void copyLink(authorizeUrl) },
          }, t(copyResult ?? 'copyLink')), t('browserDescription'))
        : h('p', { className: css.dialogText }, error ? t(failureKey) : expired ? t('timeoutDescription') : t('loginDescription')))
    }

    /* ------------------------------------------------------------- launcher */

    /**
     * Sidebar account launcher with one extra row: the shipped menu plus
     * "restart DSH" below sign-out.
     */
    function RestartAccountMenu(props) {
      const {
        wide, settingsShortcut, openSettings, openOnboarding, useAccount, t, renderSlot,
        contactUs, signOut, hasRunningAccountTasks, startSignIn, cancelSignIn, requestRestart, restartSupported,
        subscribeModelSignInRequired, subscribeSessionExpired, colorScheme,
      } = props
      const snapshot = useAccount(state => state)
      const account = snapshot ?? EMPTY_ACCOUNT
      const signedIn = account.view?.status === 'credential-stored'
      const profile = account.details?.profile
      const label = profile !== undefined && profile.status === 'ready'
        ? (profile.value.name ?? profile.value.contact ?? t('signedIn')) : t('signedIn')
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [signOutRunning, setSignOutRunning] = useState(undefined)
      const [signOutFailed, setSignOutFailed] = useState(false)
      const [restartOpen, setRestartOpen] = useState(false)
      const [restarting, setRestarting] = useState(false)
      const [restartFailed, setRestartFailed] = useState(false)
      const [restartStalled, setRestartStalled] = useState(false)
      const [restartLogPath, setRestartLogPath] = useState(undefined)
      const restartTimer = useRef(null)
      const [loginVisible, setLoginVisible] = useState(false)
      const [notice, setNotice] = useState(0)
      const [expired, setExpired] = useState(false)
      const trigger = useRef(null)

      useEffect(() => {
        if (subscribeModelSignInRequired === undefined) return undefined
        return subscribeModelSignInRequired(() => { setNotice(value => value + 1) })
      }, [subscribeModelSignInRequired])
      useEffect(() => {
        if (subscribeSessionExpired === undefined) return undefined
        return subscribeSessionExpired(() => { setExpired(true) })
      }, [subscribeSessionExpired])

      useEffect(() => () => {
        if (restartTimer.current !== null) { clearTimeout(restartTimer.current); restartTimer.current = null }
      }, [])
      const openAccount = () => { openSettings('account') }
      const beginSignIn = () => {
        setOpen(false)
        setLoginVisible(true)
        void Promise.resolve().then(startSignIn).catch(() => undefined)
      }
      const requestSignOut = async () => {
        setBusy(true)
        try { setSignOutRunning(await hasRunningAccountTasks()) }
        catch (_error) { setSignOutRunning('unknown') }
        finally { setBusy(false); setOpen(false) }
      }
      const confirmSignOut = async () => {
        setBusy(true)
        setSignOutFailed(false)
        try { await signOut(); setSignOutRunning(undefined) } catch (_error) { setSignOutFailed(true) } finally { setBusy(false) }
      }
      const confirmRestart = () => {
        setRestarting(true)
        setRestartFailed(false)
        setRestartStalled(false)
        if (restartTimer.current !== null) { clearTimeout(restartTimer.current); restartTimer.current = null }
        requestRestart().then((result) => {
          setRestartLogPath(result?.logPath)
          restartTimer.current = setTimeout(() => {
            restartTimer.current = null
            setRestarting(false)
            setRestartStalled(true)
          }, RESTART_WATCHDOG_MS)
        }).catch(() => {
          setRestarting(false)
          setRestartFailed(true)
        })
      }

      let notifications = null
      if (wide && typeof renderSlot === 'function') {
        try {
          notifications = renderSlot('settings.launcher.notifications', {
            active: signedIn && !account.desktopOnboardingVisible && !account.onboarding,
            openAccount,
          })
        } catch (_error) { notifications = null }
      }

      const items = [
        {
          id: 'settings', label: t('settings'), icon: h(P.IconSettingsOutlineMedium, { size: 16 }),
          ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }),
        },
        { id: 'contact', label: t('contactUs'), icon: h(P.IconPaperPlaneOutlineMedium, { size: 16 }) },
        signedIn
          ? { id: 'signout', label: t('signOut'), icon: h(LogoutIcon, null), disabled: busy }
          : { id: 'signin', label: t('signIn'), icon: h(P.IconUserOutlineMedium, { size: 16 }) },
      ]
      if (restartSupported !== false) {
        items.push({ id: 'restart', label: t('restartDsh'), icon: h(P.IconRefreshOutlineMedium, { size: 16 }) })
      }

      return h(React.Fragment, null,
        h('div', { className: css.root, 'data-inset': signedIn && wide },
          notice > 0 && h(P.Toast, {
            key: notice, text: t('modelSignInRequired'), onDone: () => { setNotice(0) },
          }),
          expired && h(P.Toast, { text: t('sessionExpired'), onDone: () => { setExpired(false) } }),
          notifications !== null && h('div', { className: css.notifications }, notifications),
          h(P.Menu, {
            open, side: 'top', portal: true, autoFocus: true, className: css.anchor,
            listClassName: signedIn ? undefined : css.signedOutMenu,
            anchor: h('button', {
              ref: trigger, type: 'button', className: css.trigger,
              'data-collapsed': !wide, 'data-signed-out': !signedIn,
              'aria-label': t('menu'), 'aria-haspopup': 'menu', 'aria-expanded': open,
              onClick: () => { setOpen(value => !value) },
            },
            signedIn
              ? h('span', { className: css.avatar }, h(Avatar, { account }))
              : h(P.IconEllipsisOutlineMedium, { size: 14 }),
            wide && h('span', { className: css.label }, signedIn ? label : t('more'))),
            items,
            onClose: () => { setOpen(false) },
            onSelect: (id) => {
              if (id === 'settings') { setOpen(false); trigger.current?.focus(); openSettings() }
              else if (id === 'contact') { setOpen(false); contactUs() }
              else if (id === 'signin') beginSignIn()
              else if (id === 'restart') {
                setOpen(false)
                setRestartFailed(false)
                setRestartStalled(false)
                setRestarting(false)
                setRestartOpen(true)
              }
              else void requestSignOut()
            },
          })),
        loginVisible && h(SignInDialog, {
          account, colorScheme: colorScheme(), t, start: startSignIn, cancel: cancelSignIn,
          close: () => { setLoginVisible(false) },
          useApiKey: () => { setLoginVisible(false); openOnboarding('deepseek-official') },
        }),
        signedIn && signOutRunning !== undefined
          ? h(SignOutDialog, {
            t, running: signOutRunning, busy, failed: signOutFailed,
            onCancel: () => { setSignOutRunning(undefined); setSignOutFailed(false) },
            onConfirm: () => { void confirmSignOut() },
          })
          : null,
        restartOpen
          ? h(RestartDialog, {
            t, busy: restarting, failed: restartFailed, stalled: restartStalled, logPath: restartLogPath,
            onCancel: () => {
              if (restartTimer.current !== null) { clearTimeout(restartTimer.current); restartTimer.current = null }
              setRestartOpen(false)
              setRestarting(false)
              setRestartFailed(false)
              setRestartStalled(false)
            },
            onRetry: () => { confirmRestart() },
            onConfirm: () => { confirmRestart() },
          })
          : null)
    }

    /* -------------------------------------------------------------- plugin */

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('restartDsh', { en, zh }), 'restart-account: dictionaries')

        const listeners = new Set()
        const accountStore = {
          getSnapshot: () => {
            try { return ctx.reflect.get('accountUi')?.getSnapshot() ?? EMPTY_ACCOUNT } catch (_error) { return EMPTY_ACCOUNT }
          },
          subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        }
        ctx.effect(() => ctx.on('account-ui/change', () => {
          for (const listener of listeners) listener()
        }), 'restart-account: account changes')

        const locale = () => ctx.locale.getSnapshot().active
        const metadata = () => {
          // The shipped account plugin baked the client build version in at
          // build time; borrowing its metadata keeps sign-in/out requests valid.
          try {
            const face = ctx.reflect.get('accountUi')
            if (face !== undefined && typeof face.clientMetadata === 'function') return face.clientMetadata(locale())
          } catch (_error) { /* fall through to the local shape */ }
          const version = typeof process === 'object' && process !== null && process.env !== undefined
            ? process.env.DSH_CLIENT_VERSION : undefined
          return { version: version ?? '0.2.2-rc.3', locale: locale(), timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }
        }
        const desktop = 'dshDesktop' in globalThis

        const operations = () => ({
          hooks: { account: accountStore },
          restartSupported: desktop,
          colorScheme: () => {
            try { return ctx.reflect.get('theme')?.getTheme?.().active.colorScheme ?? 'light' } catch (_error) { return 'light' }
          },
          contactUs() {
            const snapshot = accountStore.getSnapshot()
            const profile = snapshot.details?.profile
            const config = globalThis.__DSH_CONTACT_CONFIG__ ?? {}
            const context = {
              uid: profile?.status === 'ready' ? profile.value.id : null,
              version: metadata().version,
              width: window.screen.width, height: window.screen.height, pixelRatio: window.devicePixelRatio,
            }
            const openForm = (deviceInfo) => {
              window.open(contactUrl(config, { ...context, deviceInfo }), '_blank', 'noopener,noreferrer')
            }
            const readDeviceInfo = globalThis.dshDesktop?.deviceInfo
            if (typeof readDeviceInfo !== 'function') { openForm(navigator.userAgent); return }
            void (async () => {
              let deviceInfo = ''
              try { deviceInfo = await readDeviceInfo() } catch (_error) { deviceInfo = '' }
              openForm(deviceInfo)
            })()
          },
          async hasRunningAccountTasks() {
            const result = await ctx.remote.account.hasRunningAccountTasks()
            if (!result.ok) throw result.error ?? new Error('account task query failed')
            return result.value
          },
          async signOut() {
            const result = await ctx.remote.account.signOut(metadata())
            if (!result.ok) throw result.error ?? new Error('account sign out failed')
          },
          async startSignIn() {
            const transport = globalThis.__DSH_TRANSPORT__
            const origin = desktop && transport?.streamBaseUrl !== undefined
              ? new URL(transport.streamBaseUrl).origin : window.location.origin
            const result = await ctx.remote.account.startSignIn(metadata(), origin, desktop ? 'desktop' : 'web')
            if (!result.ok) throw result.error ?? new Error('account start failed')
            return result.value
          },
          async cancelSignIn(id) {
            const result = await ctx.remote.account.cancelSignIn(id)
            if (!result.ok) throw result.error ?? new Error('account cancel failed')
          },
          subscribeSessionExpired: listener => ctx.remote.$on('deepseek-account/session-expired', listener),
          subscribeModelSignInRequired: listener => ctx.remote.$on('deepseek-account/model-sign-in-required', listener),
          async requestRestart() {
            const url = new URL('restart-dsh/restart', document.baseURI)
            const response = await fetch(url, { method: 'POST', headers: { 'x-dsh-restart': '1' } })
            if (!response.ok) throw new Error(`restart request failed: ${response.status}`)
            return response.json()
          },
        })

        ctx.slots.inject('settings.launcher', () => ctx.slots.register({
          name: 'settings.launcher',
          priority: -1,
          locale: 'restartDsh',
          inject: operations,
        }, RestartAccountMenu))
      },
    }
  },
})
